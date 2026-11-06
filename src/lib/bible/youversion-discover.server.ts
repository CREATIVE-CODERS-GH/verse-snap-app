/**
 * Server-only YouVersion Search client for Discover. Loaded with a dynamic import from
 * youversion-discover.functions.ts, so it (and YOUVERSION_APP_KEY) never reaches a browser bundle.
 *
 * Documented endpoints used (https://developers.youversion.com/search-apis, /guides/images):
 *   GET /v1/search-queries   suggested (as-you-type) and trending search strings
 *   GET /v1/search-unified   topics, subtopics, image references and spelling help for one query
 *   GET /v1/search-verses    verse references, one page at a time (page_token)
 *   GET /v1/bibles/{id}/passages/{passage_id}?format=text   the text of a verse that is on screen
 *   GET /v1/images/{id}      the CDN URL and credit line of a verse image
 * Verse results are references only; the text is fetched here, per page, and never stored. Nothing is
 * cached on the server. The key and the API's own error text are never returned or logged.
 */
import { z } from "zod";
import { isOnVercel, resolveClientIp } from "./ai/client-ip.server";
import { getYouVersionEdition } from "./translations";
import {
  type DiscoverData,
  type DiscoverFailureKind,
  type DiscoverOp,
  type DiscoverRequest,
  type DiscoverResult,
} from "./youversion-discover-protocol";
import { parsePassageId } from "./youversion-discover-refs";
import { YOUVERSION_DISCOVER_ENABLED } from "./youversion-discover-schema";
import { resolveYouVersionBase } from "./youversion-base.server";
import {
  createYouVersionLimiter,
  youVersionLimiter,
  type YouVersionLimiter,
} from "./youversion-limits";

const TIMEOUT_MS = 10_000;
const LANGUAGE = "en";
/** Parallel passage fetches for one page of results. */
const PASSAGE_CONCURRENCY = 5;

/** A positive whole number from the environment (so the limits can be tuned without a code change). */
function envLimit(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Discover has its own, smaller budget so a burst of searching cannot use up the whole app key's quota that
 * Bible reading also needs: 90 requests a minute per person and 150 a minute per server instance (the
 * chapter reader has 60 and 240). `DISCOVER_RATE_PER_CLIENT` and `DISCOVER_RATE_GLOBAL` override them. These are conservative placeholders: YouVersion publishes no numeric
 * limit. Like the reader's, they live in one instance's memory (see youversion-limits.ts).
 *
 * The 429 cool-down is NOT kept here: it is the reader's shared `youVersionLimiter` cool-down (`deps.shared`),
 * so when either side is throttled by YouVersion, both stop sending until its Retry-After has passed.
 */
export const discoverLimiter: YouVersionLimiter = createYouVersionLimiter({
  perClient: envLimit("DISCOVER_RATE_PER_CLIENT", 90),
  global: envLimit("DISCOVER_RATE_GLOBAL", 150),
});

/** Identical requests that are in flight at the same moment share one upstream call. Nothing is kept after. */
const inFlight = new Map<string, Promise<DiscoverResult<DiscoverData[DiscoverOp]>>>();

const MESSAGES: Record<DiscoverFailureKind, string> = {
  network: "Verse Snap couldn't reach YouVersion right now.",
  timeout: "That search took too long.",
  limit: "You're searching quickly. Please wait a few seconds and try again.",
  denied: "Discover isn't available for this translation right now.",
  disabled: "Discover isn't available right now.",
  unavailable: "Discover search is unavailable right now.",
};

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DiscoverDeps {
  env?: Env;
  fetchImpl?: FetchLike;
  limiter?: YouVersionLimiter;
  /** The limiter whose cool-down Discover and Bible reading share (default: the reader's). */
  shared?: YouVersionLimiter;
  /** Overrides the build-time flag (tests). */
  enabled?: boolean;
  /** Who is asking, for the per-client limit. Without it every caller shares one strict bucket. */
  client?: { headers: { get(name: string): string | null }; socketIp?: string | undefined };
}

interface Failure {
  kind: DiscoverFailureKind;
  retryAfterSeconds?: number;
}

type Call = { ok: true; body: unknown } | { ok: false; status: number; failure: Failure };

function failResult(failure: Failure): DiscoverResult<never> {
  return {
    ok: false,
    kind: failure.kind,
    message: MESSAGES[failure.kind],
    ...(failure.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: failure.retryAfterSeconds }),
  };
}

function statusFailure(status: number): Failure {
  // 401/403: the key is missing, unknown or not licensed. 404: the Bible is not available to this app.
  if (status === 401 || status === 403 || status === 404) return { kind: "denied" };
  return { kind: "unavailable" };
}

interface Ctx {
  appKey: string;
  fetchImpl: FetchLike;
  limiter: YouVersionLimiter;
  shared: YouVersionLimiter;
  base: string;
  mockOrigin: string | null;
}

async function call(ctx: Ctx, path: string, params: Array<[string, string]>): Promise<Call> {
  // YouVersion is throttling the shared key: send nothing until its Retry-After has passed.
  const waiting = ctx.shared.cooldownRemaining();
  if (waiting > 0) {
    return { ok: false, status: 429, failure: { kind: "limit", retryAfterSeconds: waiting } };
  }
  const upstream = ctx.limiter.checkUpstream();
  if (!upstream.ok) {
    return {
      ok: false,
      status: 429,
      failure: { kind: "limit", retryAfterSeconds: upstream.retryAfterSeconds },
    };
  }
  const url = new URL(`${ctx.base}/v1/${path}`);
  for (const [name, value] of params) url.searchParams.append(name, value);

  let response: Response;
  try {
    response = await ctx.fetchImpl(url.toString(), {
      headers: { "X-YVP-App-Key": ctx.appKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const kind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    return { ok: false, status: 0, failure: { kind } };
  }

  if (response.status === 429) {
    // YouVersion's own limit: stop sending anything until its Retry-After has passed.
    const retryAfter = response.headers.get("retry-after");
    ctx.shared.coolDown(retryAfter);
    const seconds = Math.ceil(Number(retryAfter));
    return {
      ok: false,
      status: 429,
      failure: {
        kind: "limit",
        retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 30,
      },
    };
  }
  if (response.status === 204) return { ok: true, body: null };
  if (!response.ok) {
    return { ok: false, status: response.status, failure: statusFailure(response.status) };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, status: response.status, failure: { kind: "unavailable" } };
  }
}

const textList = z.array(z.string()).default([]);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : null));

const queriesSchema = z.object({ data: z.array(z.object({ text: z.string() })).default([]) });
const topicSchema = z.object({ text: z.string(), subtopics: textList });
const overviewSchema = z.object({
  topics: z.array(topicSchema).default([]),
  images: z.array(z.object({ id: z.string() })).default([]),
  did_you_mean: textList,
  search_instead_for: optionalText,
});
const versesSchema = z.object({
  verses: z.array(z.object({ reference: z.string() })).default([]),
  next_page_token: z.string().nullish(),
  did_you_mean: textList,
  search_instead_for: optionalText,
});
const passageSchema = z.object({ content: z.string() });
const imageSchema = z.object({
  id: z.string(),
  image_url: z.string(),
  attribution: z.string(),
  passage_id: z.string().optional(),
  aspect_ratio: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

/** Only YouVersion's own https CDN is ever handed to the browser as an image source. */
export function isTrustedImageUrl(value: string, mockOrigin: string | null = null): boolean {
  try {
    const url = new URL(value);
    if (mockOrigin && url.origin === mockOrigin) return true; // the local test mock only
    return url.protocol === "https:" && /(^|\.)youversion\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function unreadable(): DiscoverResult<never> {
  return failResult({ kind: "unavailable" });
}

function clean(list: readonly string[]): string[] {
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))];
}

export async function runDiscover<Op extends DiscoverOp>(
  request: Extract<DiscoverRequest, { op: Op }>,
  deps: DiscoverDeps = {},
): Promise<DiscoverResult<DiscoverData[Op]>> {
  return (await dispatch(request, deps)) as DiscoverResult<DiscoverData[Op]>;
}

async function dispatch(
  request: DiscoverRequest,
  deps: DiscoverDeps,
): Promise<DiscoverResult<DiscoverData[DiscoverOp]>> {
  const env = deps.env ?? process.env;
  const limiter = deps.limiter ?? discoverLimiter;
  if (!(deps.enabled ?? YOUVERSION_DISCOVER_ENABLED)) return failResult({ kind: "disabled" });
  const appKey = env["YOUVERSION_APP_KEY"]?.trim();
  if (!appKey) return failResult({ kind: "disabled" });

  const clientId = resolveClientIp({
    headers: deps.client?.headers ?? { get: () => null },
    socketIp: deps.client?.socketIp,
    onVercel: isOnVercel(env),
  });
  const decision = limiter.checkClient(clientId);
  if (!decision.ok) {
    return failResult({ kind: "limit", retryAfterSeconds: decision.retryAfterSeconds });
  }
  const { base, mockOrigin } = resolveYouVersionBase(env);
  const ctx: Ctx = {
    appKey,
    fetchImpl: deps.fetchImpl ?? fetch,
    limiter,
    shared: deps.shared ?? youVersionLimiter,
    base,
    mockOrigin,
  };
  const key = JSON.stringify(request);
  const running = inFlight.get(key);
  if (running) return running;
  const pending = execute(request, ctx).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function execute(
  request: DiscoverRequest,
  ctx: Ctx,
): Promise<DiscoverResult<DiscoverData[DiscoverOp]>> {
  const lang: [string, string] = ["language_ranges[]", LANGUAGE];

  if (request.op === "trending" || request.op === "suggest") {
    const params: Array<[string, string]> =
      request.op === "trending" ? [["trending", "true"], lang] : [["query", request.query], lang];
    const result = await call(ctx, "search-queries", params);
    if (!result.ok) return failResult(result.failure);
    // 204: nothing to suggest (or nothing trending). That is an honest empty list, never invented.
    if (result.body === null) return { ok: true, data: { queries: [] } };
    const parsed = queriesSchema.safeParse(result.body);
    if (!parsed.success) return unreadable();
    return { ok: true, data: { queries: clean(parsed.data.data.map((item) => item.text)) } };
  }

  const edition = getYouVersionEdition(request.translation);
  if (!edition) return failResult({ kind: "denied" });
  const bible: [string, string] = ["bible_id", String(edition.bibleId)];

  if (request.op === "overview") {
    const result = await call(ctx, "search-unified", [
      ["query", request.query],
      bible,
      lang,
      ["fields[]", "topics"],
      ["fields[]", "images"],
    ]);
    if (!result.ok) return failResult(result.failure);
    const parsed = overviewSchema.safeParse(result.body ?? {});
    if (!parsed.success) return unreadable();
    return {
      ok: true,
      data: {
        topics: parsed.data.topics.map((topic) => ({
          text: topic.text,
          subtopics: clean(topic.subtopics),
        })),
        imageIds: parsed.data.images.map((image) => image.id),
        didYouMean: clean(parsed.data.did_you_mean),
        searchInsteadFor: parsed.data.search_instead_for,
      },
    };
  }

  if (request.op === "verses") {
    const result = await call(ctx, "search-verses", [
      ["query", request.query],
      bible,
      ["page_size", "10"],
      ...(request.pageToken
        ? ([["page_token", request.pageToken]] as Array<[string, string]>)
        : []),
    ]);
    if (!result.ok) return failResult(result.failure);
    const parsed = versesSchema.safeParse(result.body ?? {});
    if (!parsed.success) return unreadable();
    const seen = new Set<string>();
    const passages = parsed.data.verses.flatMap((item) => {
      const passage = parsePassageId(item.reference);
      if (!passage || seen.has(passage.id)) return [];
      seen.add(passage.id);
      return [passage];
    });
    return {
      ok: true,
      data: {
        passages,
        nextPageToken: parsed.data.next_page_token ?? null,
        didYouMean: clean(parsed.data.did_you_mean),
        searchInsteadFor: parsed.data.search_instead_for,
      },
    };
  }

  if (request.op === "passages") {
    const texts: Record<string, string> = {};
    let blocked: Failure | null = null;
    for (let start = 0; start < request.ids.length && !blocked; start += PASSAGE_CONCURRENCY) {
      const batch = request.ids.slice(start, start + PASSAGE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((id) =>
          call(ctx, `bibles/${edition.bibleId}/passages/${id}`, [
            ["format", "text"],
            ["include_headings", "false"],
            ["include_notes", "false"],
          ]),
        ),
      );
      results.forEach((result, index) => {
        const id = batch[index] as string;
        if (!result.ok) {
          // A verse this edition omits is simply absent; a limit, denial or outage ends the whole request.
          if (result.status !== 404 && result.status !== 422) blocked ??= result.failure;
          return;
        }
        const parsed = passageSchema.safeParse(result.body);
        const text = parsed.success ? parsed.data.content.replace(/\s+/g, " ").trim() : "";
        if (text) texts[id] = text;
      });
    }
    if (blocked) return failResult(blocked);
    return { ok: true, data: { texts } };
  }

  // request.op === "images"
  const records = await Promise.all(
    request.ids.map((id) => call(ctx, `images/${encodeURIComponent(id)}`, [])),
  );
  const images: DiscoverData["images"]["images"] = [];
  let blocked: Failure | null = null;
  for (const record of records) {
    if (!record.ok) {
      if (record.status !== 404) blocked ??= record.failure;
      continue;
    }
    const parsed = imageSchema.safeParse(record.body);
    // An image without its credit line or from an unknown host is never shown.
    if (
      !parsed.success ||
      !parsed.data.attribution.trim() ||
      !isTrustedImageUrl(parsed.data.image_url, ctx.mockOrigin)
    )
      continue;
    const image = parsed.data;
    images.push({
      id: image.id,
      url: image.image_url,
      attribution: image.attribution.trim(),
      passage: image.passage_id ? parsePassageId(image.passage_id) : null,
      aspectRatio:
        image.aspect_ratio ?? (image.width && image.height ? image.width / image.height : 9 / 16),
    });
  }
  if (images.length === 0 && blocked) return failResult(blocked);
  return { ok: true, data: { images } };
}
