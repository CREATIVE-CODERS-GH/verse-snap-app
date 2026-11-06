import { z } from "zod";
import { isPassageId, type DiscoverPassage } from "./youversion-discover-refs";

/** Rows per page of verse results, and how many passage previews fit on one request. */
export const DISCOVER_PAGE_SIZE = 10;
/**
 * Most verses whose text is shown as a preview in one search. The NIV agreement caps what one person may
 * read at 2 chapters or 25 verses, so previews stop there; later results show the reference and open the
 * reader. Applied to both editions to keep one simple rule.
 */
export const DISCOVER_PREVIEW_CAP = 25;
export const DISCOVER_IMAGES_PER_PAGE = 6;

const translation = z.string().min(1).max(12);
const query = z.string().trim().min(1).max(100);
/**
 * YouVersion image ids are long opaque tokens (about 540 characters of letters, digits, "-", "_" and "."),
 * not short ids. Only that alphabet is accepted, so nothing else can be placed in the request path.
 */
const IMAGE_ID = z
  .string()
  .min(1)
  .max(1500)
  .regex(/^[A-Za-z0-9._-]+$/);

/** What the browser may ask the server for. Every operation is one read-only YouVersion call (or a few). */
export const discoverRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trending") }),
  z.object({ op: z.literal("suggest"), query }),
  /** Topics, related subtopics, spelling help and image references, in one unified call. */
  z.object({ op: z.literal("overview"), translation, query }),
  z.object({
    op: z.literal("verses"),
    translation,
    query,
    pageToken: z.string().min(1).max(2000).optional(),
  }),
  /** The text of the passages being shown, fetched only for what is on screen. */
  z.object({
    op: z.literal("passages"),
    translation,
    ids: z.array(z.string().refine(isPassageId)).min(1).max(DISCOVER_PAGE_SIZE),
  }),
  /** Full image records (URL, credit line) for image ids received a moment ago. */
  z.object({
    op: z.literal("images"),
    translation,
    ids: z.array(IMAGE_ID).min(1).max(DISCOVER_IMAGES_PER_PAGE),
  }),
]);

export type DiscoverRequest = z.infer<typeof discoverRequestSchema>;

export interface DiscoverTopic {
  text: string;
  subtopics: string[];
}

export interface DiscoverImage {
  /** A per-response reference. Used soon after it arrives and never stored. */
  id: string;
  /** YouVersion's CDN URL, used as returned (a `?size=` preset is added when it is displayed). */
  url: string;
  /** The credit line that must be shown wherever the image appears. */
  attribution: string;
  passage: DiscoverPassage | null;
  aspectRatio: number;
}

export interface DiscoverData {
  trending: { queries: string[] };
  suggest: { queries: string[] };
  overview: {
    topics: DiscoverTopic[];
    imageIds: string[];
    didYouMean: string[];
    searchInsteadFor: string | null;
  };
  verses: {
    passages: DiscoverPassage[];
    nextPageToken: string | null;
    didYouMean: string[];
    searchInsteadFor: string | null;
  };
  passages: { texts: Record<string, string> };
  images: { images: DiscoverImage[] };
}

export type DiscoverOp = keyof DiscoverData;

export type DiscoverFailureKind =
  "network" | "timeout" | "limit" | "denied" | "disabled" | "unavailable";

/**
 * Like the chapter function, the server never throws to the browser. Failures come back as data with a
 * fixed, user-safe message (never the API's own text, headers or key).
 */
export type DiscoverResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: DiscoverFailureKind; message: string; retryAfterSeconds?: number };
