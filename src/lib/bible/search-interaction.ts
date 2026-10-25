import { routeMessage, routeQuery } from "./search-router";
import type { ParsedReference } from "./parse-reference";

/**
 * What happens when the person presses Enter or Search in the single search bar.
 *
 * None of these actions starts AI. "Try Smart Search" is a separate button on the results page, and
 * the only way the search page requests paid AI search.
 */
export type SubmitAction =
  | { kind: "ignore" }
  | { kind: "open_reference"; reference: ParsedReference }
  | {
      kind: "free_search";
      /** The text to search for. */
      query: string;
      /** Smart Search may be offered as a separate, explicit button (not for a single keyword). */
      canOfferSmartSearch: boolean;
    }
  | { kind: "stop"; message: string };

export function decideSubmit(text: string): SubmitAction {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "ignore" };
  const decision = routeQuery(trimmed);
  if (decision.route === "reference" && decision.reference) {
    return { kind: "open_reference", reference: decision.reference };
  }
  if (decision.canSearchFree) {
    return { kind: "free_search", query: decision.query, canOfferSmartSearch: decision.canTryAi };
  }
  return {
    kind: "stop",
    message: routeMessage(decision) ?? "Try describing the verse differently.",
  };
}
