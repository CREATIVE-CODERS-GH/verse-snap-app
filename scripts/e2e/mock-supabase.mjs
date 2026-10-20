// A MOCK Supabase for browser tests: every request to the project's Supabase URL is answered here
// (DevTools Fetch interception) and anything unexpected is blocked, so no real account or data is
// touched. Supports the auth calls the app makes and PostgREST reads/writes for saved_verses,
// history and highlights (eq/in filters, insert-or-ignore, merge-duplicates, delete).
// The browser must be opened with --disable-web-security so CORS preflights never leave it.
import { readPublicEnv } from "./lib.mjs";

const KEY = ["user_id", "translation", "book_id", "chapter", "verse"];
const sameKey = (a, b) => KEY.every((column) => (a[column] ?? null) === (b[column] ?? null));

export function supabaseTarget() {
  const url = readPublicEnv("VITE_SUPABASE_URL");
  if (!url) {
    console.error(
      "VITE_SUPABASE_URL isn't set, so the app runs without accounts; nothing to test.",
    );
    process.exit(2);
  }
  const { origin, hostname } = new URL(url);
  return { origin, storageKey: `sb-${hostname.split(".")[0]}-auth-token` };
}

export function fakeUser(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${id.slice(-1)}@example.test`,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

export function fakeSession(id) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", role: "authenticated", exp })}.e2e`;
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: "e2e-refresh",
    user: fakeUser(id),
  };
}

function filterRows(rows, params) {
  return rows.filter((row) => {
    for (const [column, raw] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(column))
        continue;
      const [op, ...rest] = raw.split(".");
      const value = rest.join(".");
      const cell = String(row[column]);
      if (op === "eq" && cell !== value) return false;
      if (
        op === "in" &&
        !value
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((v) => v.replace(/"/g, ""))
          .includes(cell)
      )
        return false;
    }
    return true;
  });
}

/** Starts answering Supabase requests for the browser `b`. Returns the mock's state. */
export async function mockSupabase(b, { origin, user }) {
  const server = {
    authUser: user, // who /auth/v1/user says is signed in
    failNextWrite: {}, // table -> number of upcoming writes that fail with a 500
    tables: { saved_verses: [], history: [], highlights: [] },
    writes: [], // { table, method, prefer, onConflict, query, rows }
    blocked: [],
  };

  function rest(method, table, url, headers, body) {
    const rows = server.tables[table];
    if (!rows) return { status: 404, json: { message: `no table ${table}` } };
    const params = [...url.searchParams.entries()];
    if (method === "GET") return { status: 200, json: filterRows(rows, params) };

    const prefer = headers.Prefer ?? headers.prefer ?? "";
    const incoming = body ? [].concat(JSON.parse(body)) : [];
    server.writes.push({
      table,
      method,
      prefer,
      onConflict: url.searchParams.get("on_conflict"),
      query: url.search,
      rows: incoming,
    });
    if (server.failNextWrite[table] > 0) {
      server.failNextWrite[table] -= 1;
      return { status: 500, json: { message: "simulated outage", code: "XX000" } };
    }
    if (method === "POST") {
      for (const row of incoming) {
        const existing = rows.find((item) => sameKey(item, row));
        if (existing) {
          if (prefer.includes("ignore-duplicates")) continue;
          if (prefer.includes("merge-duplicates")) {
            Object.assign(existing, row);
            continue;
          }
          return { status: 409, json: { message: "duplicate key", code: "23505" } };
        }
        rows.push({ id: `row-${rows.length + 1}-${Math.random().toString(36).slice(2)}`, ...row });
      }
      return { status: 201 };
    }
    if (method === "DELETE") {
      const doomed = new Set(filterRows(rows, params));
      server.tables[table] = rows.filter((row) => !doomed.has(row));
      return { status: 204 };
    }
    return { status: 200, json: [] };
  }

  function respond(url, method, headers, body) {
    if (url.pathname === "/auth/v1/user")
      return server.authUser
        ? { status: 200, json: fakeUser(server.authUser) }
        : { status: 401, json: { message: "invalid JWT" } };
    if (url.pathname === "/auth/v1/logout") return { status: 204 };
    if (url.pathname === "/auth/v1/token")
      return { status: 200, json: fakeSession(server.authUser) };
    const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    return match ? rest(method, match[1], url, headers, body) : null;
  }

  await b.send("Fetch.enable", {
    patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }],
  });
  b.on("Fetch.requestPaused", async ({ requestId, request }) => {
    const url = new URL(request.url);
    const result =
      request.method === "OPTIONS"
        ? { status: 204 }
        : respond(url, request.method, request.headers, request.postData);
    if (!result) {
      server.blocked.push(`${request.method} ${url.pathname}`);
      await b
        .send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })
        .catch(() => {});
      return;
    }
    const text = result.json === undefined ? "" : JSON.stringify(result.json);
    await b
      .send("Fetch.fulfillRequest", {
        requestId,
        responseCode: result.status,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Headers", value: "*" },
          { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
        ],
        body: Buffer.from(text).toString("base64"),
      })
      .catch(() => {});
  });
  return server;
}
