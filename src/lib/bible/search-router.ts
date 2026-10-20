import { MAX_QUERY_LENGTH } from "./ai/input";
import type { SearchRoute } from "./ai/types";
import { classifyQuery } from "./classify-query";
import type { ParsedReference } from "./parse-reference";

/**
 * The deterministic router for the single search bar.
 *
 * It decides, without calling any AI and without any network access, how a query should be handled:
 *
 *   reference       a Bible reference: open it directly (free)
 *   free_confident  free full-text search found the verse: show it, offer no AI
 *   free_adequate   free search found something plausible: show it, AI help may be offered
 *   needs_ai        no usable free result and the query is a real description: AI help may be offered
 *   refine          too short, too vague or too long: ask for a better query (never AI)
 *   nonsense        keyboard mashing or non-text: say so (never AI)
 *
 * AI is only ever *offered* here (canTryAi); starting it is always an explicit user action.
 * Free full-text search does not exist yet (hybrid search, later phases). Its findings are accepted
 * through the optional `free` argument so the decision logic and its thresholds can be built and
 * tested now; with no `free` signals the router treats a real description as needs_ai.
 */

export type { SearchRoute } from "./ai/types";

/** What a free full-text search tells the router about its results. All values are computed, not guessed. */
export interface FreeSearchSignals {
  /** The query's words appear consecutively in at least one verse. */
  phraseHit: boolean;
  /** 0-1: share of the query's content words found in the best verse. */
  bestCoverage: number;
  resultCount: number;
  /** 0-1: how far the best result leads the second. */
  scoreGap: number;
  /** 0-1: share of content words not found in the Bible's vocabulary after typo repair. */
  outOfVocabularyRate: number;
}

/** Starting thresholds, to be calibrated against the evaluation set once free search exists. */
export const ROUTER_THRESHOLDS = {
  confidentCoverage: 0.8,
  confidentGap: 0.15,
  adequateCoverage: 0.5,
  nonsenseOutOfVocabulary: 0.5,
  minContentWords: 2,
} as const;

export interface QueryAnalysis {
  /** Words that carry meaning (stop words removed), lowercased. */
  contentWords: string[];
  wordCount: number;
  /** Share of the query's non-space characters that are letters. */
  letterRatio: number;
  /** Share of words that cannot plausibly be English (keyboard runs, no vowels, repeated characters). */
  implausibleWordShare: number;
  /** Phrased as a topic or question rather than a quotation ("verse about courage", "what does..."). */
  topicCue: boolean;
}

export interface RouteDecision {
  route: SearchRoute;
  /** The description to search for (conversational lead-ins removed). Empty for a reference. */
  query: string;
  reference?: ParsedReference;
  /** The person may ask for AI help with this query. */
  canTryAi: boolean;
  /** Short machine-readable reasons; never contains the query text. */
  reasons: string[];
  analysis: QueryAnalysis;
}

const STOP_WORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below " +
    "between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few " +
    "for from further had hadn't has hasn't have haven't having he her here hers him his how i if in into is isn't it " +
    "its just me more most my no nor not of off on once only or other our out over own same she should shouldn't so " +
    "some such than that the their them then there these they this those through to too under until up very was " +
    "wasn't we were weren't what when where which while who whom why will with won't would wouldn't you your yours"
  ).split(" "),
);

const TOPIC_CUES =
  /\b(?:about|regarding|concerning|on the subject of|verses? (?:for|on|about)|when (?:i|you|we)|how to|why|what does|what do|does the bible|teach(?:es|ing)?|says? about)\b/i;

const KEYBOARD_RUNS =
  /(?:qwer|wert|erty|rtyu|tyui|yuio|uiop|asdf|sdfg|dfgh|fghj|ghjk|hjkl|zxcv|xcvb|cvbn|vbnm|poiu|lkjh|mnbv)/;

function implausibleWord(word: string): boolean {
  if (word.length < 3) return false;
  if (KEYBOARD_RUNS.test(word)) return true;
  if (/(.)\1{3,}/.test(word)) return true;
  if (word.length >= 4 && !/[aeiouy]/.test(word)) return true;
  if (/[^aeiouy\W\d_]{6,}/.test(word)) return true;
  return false;
}

export function analyzeQuery(text: string): QueryAnalysis {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-zÀ-ɏ']+/g) ?? [];
  const nonSpace = lower.replace(/\s/g, "");
  const letters = nonSpace.replace(/[^a-zÀ-ɏ]/g, "");
  const contentWords = words.filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const implausible = words.filter(implausibleWord).length;
  return {
    contentWords,
    wordCount: words.length,
    letterRatio: nonSpace.length === 0 ? 0 : letters.length / nonSpace.length,
    implausibleWordShare: words.length === 0 ? 1 : implausible / words.length,
    topicCue: TOPIC_CUES.test(text),
  };
}

function looksLikeNonsense(analysis: QueryAnalysis): boolean {
  if (analysis.wordCount === 0) return true;
  if (analysis.letterRatio < 0.6) return true;
  return analysis.implausibleWordShare >= 0.6;
}

/** Two meaningful words, or one when the person framed it as a topic ("verse about forgiveness"). */
function hasEnoughWords(analysis: QueryAnalysis): boolean {
  const count = analysis.contentWords.length;
  return count >= ROUTER_THRESHOLDS.minContentWords || (count >= 1 && analysis.topicCue);
}

/**
 * Decides how to handle a query. Pure: same input, same answer, no I/O.
 * `free` (optional) carries the findings of a free full-text search once one exists.
 */
export function routeQuery(raw: string, free?: FreeSearchSignals): RouteDecision {
  const text = raw.trim();
  const emptyAnalysis = analyzeQuery("");

  if (!text) {
    return {
      route: "refine",
      query: "",
      canTryAi: false,
      reasons: ["empty"],
      analysis: emptyAnalysis,
    };
  }

  const intent = classifyQuery(text);
  if (intent?.kind === "reference") {
    return {
      route: "reference",
      query: "",
      reference: intent.reference,
      canTryAi: false,
      reasons: ["reference"],
      analysis: analyzeQuery(text),
    };
  }

  const query = intent?.kind === "description" ? intent.query : text;
  // Topic cues ("verse about ...") are read from what the person typed, before lead-ins are stripped.
  const analysis = { ...analyzeQuery(query), topicCue: TOPIC_CUES.test(text) };
  const base = { query, analysis };

  if (query.length > MAX_QUERY_LENGTH) {
    return { ...base, route: "refine", canTryAi: false, reasons: ["too_long"] };
  }
  if (looksLikeNonsense(analysis)) {
    return { ...base, route: "nonsense", canTryAi: false, reasons: ["implausible_text"] };
  }

  if (free) {
    const t = ROUTER_THRESHOLDS;
    if (free.outOfVocabularyRate >= t.nonsenseOutOfVocabulary && free.resultCount === 0) {
      return { ...base, route: "nonsense", canTryAi: false, reasons: ["unknown_words"] };
    }
    if (free.phraseHit) {
      return { ...base, route: "free_confident", canTryAi: false, reasons: ["phrase_match"] };
    }
    if (free.bestCoverage >= t.confidentCoverage && free.scoreGap >= t.confidentGap) {
      return {
        ...base,
        route: "free_confident",
        canTryAi: false,
        reasons: ["clear_keyword_match"],
      };
    }
    if (free.resultCount > 0 && free.bestCoverage >= t.adequateCoverage) {
      return {
        ...base,
        route: "free_adequate",
        canTryAi: true,
        reasons: ["partial_keyword_match"],
      };
    }
    if (!hasEnoughWords(analysis) && free.resultCount === 0) {
      return { ...base, route: "refine", canTryAi: false, reasons: ["too_few_words"] };
    }
    return { ...base, route: "needs_ai", canTryAi: true, reasons: ["weak_free_results"] };
  }

  if (!hasEnoughWords(analysis)) {
    return { ...base, route: "refine", canTryAi: false, reasons: ["too_few_words"] };
  }
  return {
    ...base,
    route: "needs_ai",
    canTryAi: true,
    reasons: analysis.topicCue
      ? ["free_search_unavailable", "topic_cue"]
      : ["free_search_unavailable"],
  };
}

/** Plain-language note for the routes that stop short of search; null when none is needed. */
export function routeMessage(decision: Pick<RouteDecision, "route" | "reasons">): string | null {
  switch (decision.route) {
    case "refine":
      return decision.reasons.includes("too_long")
        ? `Please use ${MAX_QUERY_LENGTH} characters or fewer to describe the verse.`
        : "Add a few more words, or enter a reference such as John 3:16.";
    case "nonsense":
      return "We couldn't make sense of that. Describe the verse in words, or enter a reference such as John 3:16.";
    default:
      return null;
  }
}
