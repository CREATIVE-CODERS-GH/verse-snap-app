/**
 * Server-only YouVersion Platform client. Loaded with a dynamic import from youversion.functions.ts,
 * so it (and YOUVERSION_APP_KEY) never reaches a browser bundle.
 *
 * Documented endpoint used: GET https://api.youversion.com/v1/bibles/{bible_id}/passages/{USFM}
 * with `format=html`, headings and notes off. One request per chapter, no bulk fetching.
 *
 * Nothing is cached or stored here: the licences do not clearly permit it, and every fetch is on demand.
 * Only identical in-flight requests are shared. The key and the API's own error text are never returned
 * or logged.
 */
import { findBook } from "./books";
import { toUsfmBookId } from "./youversion-books";
import { parseChapterHtml } from "./youversion-html";
import type {
  YouVersionChapterRequest,
  YouVersionChapterResult,
  YouVersionFailureKind,
} from "./youversion-protocol";
import { getYouVersionEdition } from "./translations";
import { isOnVercel, resolveClientIp } from "./ai/client-ip.server";
import { resolveYouVersionBase } from "./youversion-base.server";
import { youVersionLimiter, type YouVersionLimiter } from "./youversion-limits";

const TIMEOUT_MS = 12_000;

const MESSAGES: Record<YouVersionFailureKind, string> = {
  network: "Verse Snap couldn't reach this Bible right now.",
  translation: "This translation isn't available right now.",
  reference: "That chapter isn't available in this translation.",
  provider: "Verse Snap couldn't retrieve that passage.",
};

function fail(kind: YouVersionFailureKind, message = MESSAGES[kind]): YouVersionChapterResult {
  return { ok: false, kind, message };
}

const QUICK_MESSAGE = "You're moving quickly. Please wait a few seconds and try again.";
const BUSY_MESSAGE = "This translation is busy right now. Please try again in a moment.";

function limited(
  scope: "client" | "global" | "cooldown",
  retryAfterSeconds: number,
): YouVersionChapterResult {
  return {
    ok: false,
    kind: "provider",
    message: scope === "client" ? QUICK_MESSAGE : BUSY_MESSAGE,
    retryAfterSeconds,
  };
}

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface YouVersionDeps {
  env?: Env;
  fetchImpl?: FetchLike;
  limiter?: YouVersionLimiter;
  /** Who is asking, for the per-client limit. Without it every caller shares one strict bucket. */
  client?: { headers: { get(name: string): string | null }; socketIp?: string | undefined };
}

const inFlight = new Map<string, Promise<YouVersionChapterResult>>();

export function getChapterFromYouVersion(
  request: YouVersionChapterRequest,
  deps: YouVersionDeps = {},
): Promise<YouVersionChapterResult> {
  const limiter = deps.limiter ?? youVersionLimiter;
  const clientId = resolveClientIp({
    headers: deps.client?.headers ?? { get: () => null },
    socketIp: deps.client?.socketIp,
    onVercel: isOnVercel(deps.env ?? process.env),
  });
  const decision = limiter.checkClient(clientId);
  if (!decision.ok) return Promise.resolve(limited(decision.scope, decision.retryAfterSeconds));

  const key = `${request.translation}/${request.bookId}/${request.chapter}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = load(request, deps).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function load(
  request: YouVersionChapterRequest,
  { env = process.env, fetchImpl = fetch, limiter = youVersionLimiter }: YouVersionDeps,
): Promise<YouVersionChapterResult> {
  const edition = getYouVersionEdition(request.translation);
  if (!edition) return fail("translation");

  const appKey = env["YOUVERSION_APP_KEY"]?.trim();
  if (!appKey) return fail("translation");

  const usfm = toUsfmBookId(request.bookId);
  const book = findBook(request.bookId);
  if (!usfm || !book || request.chapter > book.chapters) return fail("reference");

  const url =
    `${resolveYouVersionBase(env).base}/v1/bibles/${edition.bibleId}/passages/${usfm}.${request.chapter}` +
    "?format=html&include_headings=false&include_notes=false";

  const upstream = limiter.checkUpstream();
  if (!upstream.ok) return limited(upstream.scope, upstream.retryAfterSeconds);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "X-YVP-App-Key": appKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail("network");
  }

  if (response.status === 404 || response.status === 422) return fail("reference");
  // 401/403/412: the key is missing, unknown, archived, or not licensed for this edition. Never retried.
  if (response.status === 401 || response.status === 403 || response.status === 412)
    return fail("translation");
  if (response.status === 429) {
    // YouVersion's own limit: stop sending anything until its Retry-After has passed.
    limiter.coolDown(response.headers.get("retry-after"));
    return limited("cooldown", 30);
  }
  if (!response.ok) return fail("provider");

  let html: unknown;
  try {
    html = ((await response.json()) as { content?: unknown }).content;
  } catch {
    return fail("provider", "Verse Snap received an unreadable response.");
  }
  if (typeof html !== "string") return fail("provider", "The chapter text is unavailable.");

  const verses = parseChapterHtml(html);
  if (verses.length === 0) return fail("provider", "The chapter text is unavailable.");
  return { ok: true, verses };
}
