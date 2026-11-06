import type { QueryClient } from "@tanstack/react-query";
import { YOUVERSION_EDITIONS } from "./translations";

/**
 * The React Query keys whose data holds Scripture text, by their first element. Every query that
 * returns a Verse or Chapter must use one of these roots with the translation code second.
 */
export const SCRIPTURE_QUERY_ROOTS = [
  "chapter",
  "verse",
  "verse-neighbours",
  // Discover's passage previews (youversion-discover.ts), keyed ["discover-preview", translation, ids].
  "discover-preview",
] as const;

/**
 * Licensed editions (NIV, AMP) are not kept once the screen that asked for them has gone: the
 * caching permission for their text is unconfirmed, so unlike the free editions (10 minutes fresh,
 * an hour in memory) they are dropped the moment no screen uses them (`gcTime: 0`) and fetched again
 * whenever a screen asks (`staleTime: 0`). While a screen is open, React Query still shares one
 * request between components that ask for the same thing, which keeps chapter navigation and
 * cross-references inside the server's rate limit.
 *
 * Applied once when the router is created. Free editions keep the app-wide defaults.
 */
export function applyLicensedQueryPolicy(client: QueryClient): void {
  for (const root of SCRIPTURE_QUERY_ROOTS) {
    for (const edition of YOUVERSION_EDITIONS) {
      client.setQueryDefaults([root, edition.code], { gcTime: 0, staleTime: 0 });
    }
  }
}
