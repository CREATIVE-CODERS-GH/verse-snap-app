/**
 * The "Try searching for" suggestions from the approved Stitch design. The label is what the person
 * sees; the query is what is actually searched (a bare "Peace" would be too vague for the router).
 */
export type SuggestionIcon = "droplet" | "sprout" | "heart" | "book" | "sun";

export interface SearchSuggestion {
  label: string;
  query: string;
  icon: SuggestionIcon;
}

export const SEARCH_SUGGESTIONS: readonly SearchSuggestion[] = [
  { label: "Peace", query: "verses about peace", icon: "droplet" },
  { label: "Renewing your mind", query: "verse about renewing your mind", icon: "sprout" },
  { label: "Comfort in trials", query: "verses about comfort in trials", icon: "heart" },
  { label: "John 3:16", query: "John 3:16", icon: "book" },
  { label: "Hope", query: "verses about hope", icon: "sun" },
];
