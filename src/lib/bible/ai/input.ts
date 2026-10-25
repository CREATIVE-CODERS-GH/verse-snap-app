import { z } from "zod";

/** Longest natural-language description accepted for AI search. */
export const MAX_QUERY_LENGTH = 200;
export const MIN_QUERY_LENGTH = 2;

/**
 * Shape check for the server function. Length rules are enforced by the search service,
 * before any quota is spent or paid request is made, so a too-long description gets a
 * friendly message instead of a generic validation failure. The hard cap here only stops
 * absurdly large payloads.
 */
export const searchInputSchema = z.object({
  query: z.string().max(2000),
  translation: z.string().min(2).max(12).optional(),
});

export type SearchInput = z.infer<typeof searchInputSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export type QueryCheck = { ok: true; query: string } | { ok: false; message: string };

/** Trims and validates a search description. */
export function checkQuery(raw: string): QueryCheck {
  const query = raw.trim().replace(/\s+/g, " ");
  if (query.length < MIN_QUERY_LENGTH) {
    return { ok: false, message: "Describe the verse you are looking for." };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      message: `Please use ${MAX_QUERY_LENGTH} characters or fewer to describe the verse.`,
    };
  }
  if (CONTROL_CHARACTERS.test(query)) {
    return { ok: false, message: "That search contains characters we can't use." };
  }
  return { ok: true, query };
}
