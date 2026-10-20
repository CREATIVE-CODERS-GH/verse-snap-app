/** Shapes shared by the AI search modules. Safe to import from browser code (types only). */

export interface ScriptureSearchResult {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  reference: string;
  text: string;
}

/** How the router decided to handle a query (see src/lib/bible/search-router.ts). */
export type SearchRoute =
  "reference" | "free_confident" | "free_adequate" | "needs_ai" | "refine" | "nonsense";

/** Where the results came from. */
export type SearchSource = "reference" | "text" | "ai" | "mixed";

/**
 * State of the optional AI helper for this response:
 *  off          not enabled or not configured (free search is unaffected)
 *  available    AI could be requested (the person has not asked yet)
 *  used         these results came from AI
 *  limit        a usage limit was reached
 *  unavailable  AI could not be reached or its limits could not be checked
 */
export type AiStatus = "off" | "available" | "used" | "limit" | "unavailable";

export interface ScriptureSearchResponse {
  results: ScriptureSearchResult[];
  /** True when the lookup itself failed rather than simply finding nothing. */
  failed: boolean;
  errorMessage?: string;
  /** Optional additions; existing callers can ignore them. */
  source?: SearchSource;
  route?: SearchRoute;
  /** The person may ask for AI help with this query. */
  canTryAi?: boolean;
  aiStatus?: AiStatus;
}

export interface ReferenceCandidate {
  book: string;
  chapter: number;
  verse: number;
}

export type AiProviderErrorKind =
  /** Missing/invalid credentials or provider disabled: nothing can be searched. */
  | "not_configured"
  /** Rate limit, spend limit, timeout, outage, or an incomplete response. */
  | "unavailable"
  /** The provider declined to answer. Treated as "no results". */
  | "refused"
  /** The provider answered, but not in the expected shape. */
  | "invalid_output";

/**
 * Provider failures carry only a kind and an optional HTTP status. The provider's own
 * error text is never kept, so it cannot reach the browser or the logs by accident.
 */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiProviderErrorKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = "AiProviderError";
  }
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Estimated from list prices; null when the model's price is unknown. */
  estimatedCostUsd: number | null;
}

export interface FindCandidatesInput {
  query: string;
  maxCandidates: number;
  signal?: AbortSignal;
}

export interface FindCandidatesOutput {
  candidates: ReferenceCandidate[];
  usage?: ProviderUsage;
}

/** The only provider-specific step of AI search. Add a provider by implementing this. */
export interface ReferenceProvider {
  readonly id: string;
  findCandidates(input: FindCandidatesInput): Promise<FindCandidatesOutput>;
}
