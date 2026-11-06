import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import {
  DISCOVER_PREVIEW_CAP,
  type DiscoverData,
  type DiscoverFailureKind,
  type DiscoverOp,
  type DiscoverRequest,
  type DiscoverResult,
} from "./youversion-discover-protocol";
import { getYouVersionEdition, YOUVERSION_EDITIONS } from "./translations";

/** The server function, as the page gets it from `useServerFn`. */
export type DiscoverRunner = (input: {
  data: DiscoverRequest;
  signal?: AbortSignal;
}) => Promise<DiscoverResult<DiscoverData[DiscoverOp]>>;

/** A failed Discover call. `message` is fixed, user-safe wording; it never carries the API's own text. */
export class DiscoverError extends Error {
  readonly kind: DiscoverFailureKind;
  readonly retryAfterSeconds: number | undefined;
  constructor(kind: DiscoverFailureKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "DiscoverError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const NETWORK_MESSAGE = "Verse Snap couldn't reach YouVersion right now.";

/**
 * Runs one operation and returns its data, or throws a DiscoverError. A request that was cancelled
 * (a newer search replaced it) rethrows the abort untouched so React Query treats it as cancelled.
 */
export async function callDiscover<Op extends DiscoverOp>(
  run: DiscoverRunner,
  request: Extract<DiscoverRequest, { op: Op }>,
  signal?: AbortSignal,
): Promise<DiscoverData[Op]> {
  let result: DiscoverResult<DiscoverData[DiscoverOp]>;
  try {
    result = await run(signal ? { data: request, signal } : { data: request });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DiscoverError("network", NETWORK_MESSAGE);
  }
  if (!result.ok) throw new DiscoverError(result.kind, result.message, result.retryAfterSeconds);
  return result.data as DiscoverData[Op];
}

const MINUTE = 60_000;

/**
 * Query options for Discover. Trending, suggestions, topics and image records are not Scripture, so they
 * use ordinary short in-memory caching (never persisted). Passage text is licensed: its key root
 * "discover-preview" is in SCRIPTURE_QUERY_ROOTS (query-policy.ts), so it is dropped the moment no screen
 * shows it. Nothing here retries on its own; a failure waits for the person to tap Try again.
 * `networkMode: "always"`: React Query would otherwise pause these queries while the browser is offline and
 * leave the screen loading forever; here the request is attempted, fails, and the offline message shows.
 */
export function trendingOptions(run: DiscoverRunner) {
  return queryOptions({
    queryKey: ["discover", "trending"],
    queryFn: ({ signal }) => callDiscover(run, { op: "trending" }, signal),
    staleTime: 5 * MINUTE,
    gcTime: 10 * MINUTE,
    retry: false,
    networkMode: "always",
  });
}

export function suggestOptions(run: DiscoverRunner, query: string) {
  return queryOptions({
    queryKey: ["discover", "suggest", query.toLowerCase()],
    queryFn: ({ signal }) => callDiscover(run, { op: "suggest", query }, signal),
    staleTime: MINUTE,
    gcTime: 5 * MINUTE,
    retry: false,
    networkMode: "always",
    // Keep the last list on screen while the next one loads, so the panel does not flicker per keystroke.
    placeholderData: keepPreviousData,
  });
}

export function overviewOptions(run: DiscoverRunner, translation: string, query: string) {
  return queryOptions({
    queryKey: ["discover", "overview", translation, query],
    queryFn: ({ signal }) => callDiscover(run, { op: "overview", translation, query }, signal),
    staleTime: 2 * MINUTE,
    // Image ids are per-response references that are used soon after they arrive.
    gcTime: 2 * MINUTE,
    retry: false,
    networkMode: "always",
  });
}

export function versesInfiniteOptions(run: DiscoverRunner, translation: string, query: string) {
  return infiniteQueryOptions({
    queryKey: ["discover", "verses", translation, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      callDiscover(
        run,
        { op: "verses", translation, query, ...(pageParam ? { pageToken: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    staleTime: 2 * MINUTE,
    gcTime: 5 * MINUTE,
    retry: false,
    networkMode: "always",
  });
}

export function previewOptions(run: DiscoverRunner, translation: string, id: string) {
  return queryOptions({
    // Root and translation first: see SCRIPTURE_QUERY_ROOTS. One verse per query, requested only once its
    // row is near the screen (see DiscoverVerseRow), so a search never fetches text nobody sees.
    queryKey: ["discover-preview", translation, id],
    queryFn: ({ signal }) => callDiscover(run, { op: "passages", translation, ids: [id] }, signal),
    retry: false,
    networkMode: "always",
  });
}

export function imagesOptions(run: DiscoverRunner, translation: string, ids: readonly string[]) {
  return queryOptions({
    queryKey: ["discover", "images", translation, ids.join(",")],
    queryFn: ({ signal }) =>
      callDiscover(run, { op: "images", translation, ids: [...ids] }, signal),
    staleTime: 5 * MINUTE,
    gcTime: 5 * MINUTE,
    retry: false,
    networkMode: "always",
  });
}

/** Whether the verse at this position in the results may show its text (the preview cap). */
export function canPreview(index: number, cap: number = DISCOVER_PREVIEW_CAP): boolean {
  return index < cap;
}

function waitWording(seconds: number): string {
  if (seconds <= 90) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

export interface DescribedError {
  kind: DiscoverFailureKind;
  title: string;
  message: string;
  retryAfterSeconds?: number;
}

/** User-facing wording for a failed Discover query, including the offline case. */
export function describeDiscoverError(
  error: unknown,
  options: { translation: string; online: boolean },
): DescribedError {
  const kind: DiscoverFailureKind = error instanceof DiscoverError ? error.kind : "network";
  const retryAfterSeconds = error instanceof DiscoverError ? error.retryAfterSeconds : undefined;
  const extra = retryAfterSeconds === undefined ? {} : { retryAfterSeconds };
  if (kind === "network" && !options.online) {
    return {
      kind,
      title: "You're offline",
      message: "Discover needs an internet connection. Reconnect and try again.",
      ...extra,
    };
  }
  switch (kind) {
    case "network":
      return {
        kind,
        title: "Connection problem",
        message: "We couldn't reach YouVersion. Please check your connection and try again.",
        ...extra,
      };
    case "timeout":
      return {
        kind,
        title: "That took too long",
        message: "The search didn't finish in time. Please try again.",
        ...extra,
      };
    case "limit":
      return {
        kind,
        title: "Slow down a moment",
        message:
          retryAfterSeconds && retryAfterSeconds > 0
            ? `You've searched a lot in a short time. Please wait about ${waitWording(retryAfterSeconds)} and try again.`
            : "You've searched a lot in a short time. Please wait a moment and try again.",
        ...extra,
      };
    case "denied":
      return {
        kind,
        title: `Not available in ${options.translation}`,
        message: `Discover can't search ${options.translation} right now. Try another translation, or use Verse Snap search.`,
        ...extra,
      };
    case "disabled":
      return {
        kind,
        title: "Discover isn't available",
        message: "Discover search is switched off right now. Verse Snap search still works.",
        ...extra,
      };
    default:
      return {
        kind,
        title: "Search didn't finish",
        message: "Discover search is unavailable right now. Please try again in a moment.",
        ...extra,
      };
  }
}

/**
 * The edition Discover searches: the one in the URL, else the reader's own choice when it is a YouVersion
 * edition, else the first one (NIV). Anything else, such as KJAV, is never sent to YouVersion.

*/
export function resolveDiscoverTranslation(fromUrl: string | undefined, preferred: string): string {
  if (fromUrl && getYouVersionEdition(fromUrl)) return fromUrl;
  if (getYouVersionEdition(preferred)) return preferred;
  return YOUVERSION_EDITIONS[0]?.code ?? "NIV";
}
