import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { parseReference } from "./parse-reference";
import { bibleService, DEFAULT_TRANSLATION } from "./service";
import type { Verse } from "./types";
import { findBook } from "./books";
import { resolveTranslation } from "./translations";

const MAX_RESULTS = 8;
const MAX_CANDIDATES = 12;
const CACHE_LIMIT = 100;

export interface ScriptureSearchResult {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  reference: string;
  text: string;
}

export interface ScriptureSearchResponse {
  results: ScriptureSearchResult[];
  /** True when the lookup itself failed rather than simply finding nothing. */
  failed: boolean;
  errorMessage?: string;
}

const Input = z.object({
  query: z.string().trim().min(1).max(500),
  translation: z.string().min(2).max(12).optional(),
  indexed: z.array(z.object({
    bookId: z.string().max(30), bookName: z.string().max(40),
    chapter: z.number().int().min(1).max(150), verse: z.number().int().min(1).max(176),
    confidence: z.number().min(0).max(1),
  })).max(12).optional(),
});

const cache = new Map<string, ScriptureSearchResponse>();

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const requestLog = new Map<string, number[]>();

/** Cheap per-caller throttle so the semantic endpoint cannot be hammered. */
function withinRateLimit(caller: string): boolean {
  const now = Date.now();
  const recent = (requestLog.get(caller) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  recent.push(now);
  requestLog.set(caller, recent);
  if (requestLog.size > 500) {
    for (const [key, times] of requestLog) {
      if (times.every((at) => now - at >= RATE_WINDOW_MS)) requestLog.delete(key);
    }
  }
  return recent.length <= RATE_LIMIT;
}

function cacheKey(query: string, translation: string): string {
  return `${translation}::${query.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["references"],
  properties: {
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["book", "chapter", "verse"],
        properties: {
          book: { type: "string" },
          chapter: { type: "integer" },
          verse: { type: "integer" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You identify which existing Bible verses a person is describing.",
  "Return only references (book name, chapter number, verse number) for verses that really exist.",
  "Never write, quote or paraphrase scripture text.",
  `Return the ${MAX_CANDIDATES} most likely references, best match first.`,
  "If the description clearly matches one famous verse, put it first.",
  "Interpret exact quotations, partial quotations, paraphrases, topics, singular/plural variants,",
  "punctuation differences and small spelling mistakes. Do not require exact wording.",
  "People may quote a different translation from the edition selected for display,",
  "so match on meaning and passage, not edition-specific wording: for example 'love is patient'",
  "is 1 Corinthians 13:4, also rendered 'charity suffereth long' in King James wording.",
  "Examples: 'I can do all things through Christ' is Philippians 4:13; 'renewing your mind'",
  "is Romans 12:2; 'being anxious' likely includes Philippians 4:6; 'all things together for good'",
  "is Romans 8:28; 'be strong and courageous' likely includes Joshua 1:9.",
  "If nothing plausibly matches, return an empty list.",
].join(" ");

interface Candidate {
  book: string;
  chapter: number;
  verse: number;
}

class SearchGatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reads the streamed Responses API body and returns the joined output text. */
async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string | string[] };
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (event.type === "response.completed") {
          const output = event.response?.output_text;
          completed = Array.isArray(output) ? output.join("") : (output ?? "");
        }
      } catch {
        /* ignore partial or non-JSON keepalive frames */
      }
    }
  }

  return text || completed;
}

async function askForCandidates(query: string): Promise<Candidate[]> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new SearchGatewayError(401, "Scripture search is not configured.");
  }

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: query }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "bible_references",
            strict: true,
            schema: SCHEMA,
          },
        },
      }),
    });

    if (response.ok) break;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) break;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 3000)
        : 500 * 2 ** attempt + Math.floor(Math.random() * 200);
    await response.body?.cancel();
    await delay(wait);
  }

  if (!response?.ok) {
    const status = response?.status ?? 503;
    const body = response ? await response.text().catch(() => "") : "";
    let message = "Scripture search is unavailable right now.";
    try {
      const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } };
      const supplied = parsed.message ?? parsed.error?.message;
      if (typeof supplied === "string" && supplied.trim()) message = supplied.trim();
    } catch {
      if (body.trim() && body.length < 240) message = body.trim();
    }
    console.error("Scripture search upstream failed", status);
    throw new SearchGatewayError(status, message);
  }

  const raw = await readStream(response);
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as { references?: unknown };
    if (!Array.isArray(parsed.references)) return [];
    return parsed.references.flatMap((item): Candidate[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const book = typeof value["book"] === "string" ? value["book"] : "";
      const chapter = Number(value["chapter"]);
      const verse = Number(value["verse"]);
      if (!book || !Number.isInteger(chapter) || !Number.isInteger(verse)) return [];
      return [{ book, chapter, verse }];
    });
  } catch {
    return [];
  }
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "that",
  "to",
  "in",
  "is",
  "it",
  "for",
  "verse",
  "bible",
  "about",
  "says",
  "say",
  "where",
  "what",
  "which",
  "does",
  "god",
]);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

/** Exact wording wins, then overlapping words, then the order suggested upstream. */
function score(query: string, verse: Verse, order: number): number {
  const text = normalise(verse.text);
  const cleaned = normalise(query);
  // The upstream ordering carries the meaning of the query, so it leads;
  // wording overlap only nudges close calls.
  let value = Math.max(0, MAX_CANDIDATES - order) * 10;
  if (cleaned && text.includes(cleaned)) value += 1000;

  const words = cleaned.split(" ").filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  if (words.length > 0) {
    const textWords = text.split(" ").map(stem);
    const hits = words.filter((word) => {
      const queryWord = stem(word);
      return textWords.some(
        (textWord) =>
          textWord === queryWord || (queryWord.length >= 5 && withinOneEdit(queryWord, textWord)),
      );
    }).length;
    value += Math.round((hits / words.length) * 40);
    if (hits === words.length) value += 20;
  }
  return value;
}

async function runSearch(query: string, translation: string, indexed: z.infer<typeof Input>["indexed"] = []): Promise<ScriptureSearchResponse> {
  // Indexed citations are untrusted hints, never text or an authority to cache.
  const lexical = (indexed ?? []).flatMap((hit): Candidate[] => {
    const book = findBook(hit.bookId);
    return book ? [{ book: book.name, chapter: hit.chapter, verse: hit.verse }] : [];
  });
  let semantic: Candidate[] = [];
  let gatewayError: unknown;
  try {
    semantic = await askForCandidates(query);
  } catch (error) {
    gatewayError = error;
    if (!lexical.length) return {
      results: [],
      failed: true,
      errorMessage:
        error instanceof SearchGatewayError
          ? error.message
          : "Scripture search is unavailable right now.",
    };
  }

  // Interleave sources so either can recover candidates the other missed.
  const candidates: Candidate[] = [];
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const local = lexical[i];
    const suggested = semantic[i];
    if (local) candidates.push(local);
    if (suggested) candidates.push(suggested);
  }

  const seen = new Set<string>();
  const verses: Array<{ verse: Verse; order: number }> = [];

  await Promise.all(
    candidates.map(async (candidate, order) => {
      const reference = parseReference(`${candidate.book} ${candidate.chapter}:${candidate.verse}`);
      if (!reference || reference.verse === undefined) return;
      const key = `${reference.bookId}-${reference.chapter}-${reference.verse}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        // Scripture text always comes from the Bible source, never the model.
        const verse = await bibleService.getVerse(
          {
            bookId: reference.bookId,
            bookName: reference.bookName,
            chapter: reference.chapter,
            verse: reference.verse,
          },
          translation,
        );
        if (verse) verses.push({ verse, order });
      } catch {
        /* an unreachable verse is simply left out of the results */
      }
    }),
  );

  const results = verses
    .sort((a, b) => score(query, b.verse, b.order) - score(query, a.verse, a.order))
    .slice(0, MAX_RESULTS)
    .map(({ verse }) => ({
      translation: verse.translation,
      bookId: verse.bookId,
      bookName: verse.bookName,
      chapter: verse.chapter,
      verse: verse.verse,
      reference: verse.reference,
      text: verse.text,
    }));

  return { results, failed: results.length === 0 && (Boolean(gatewayError) || candidates.length > 0),
    ...(results.length === 0 && (gatewayError || candidates.length > 0)
      ? { errorMessage: "Couldn't retrieve matching verses right now. Try again." } : {}) };
}

/** Internal entry point kept separate so reliability checks can exercise the full server pipeline. */
export async function runScriptureSearch(
  query: string,
  translation = DEFAULT_TRANSLATION,
): Promise<ScriptureSearchResponse> {
  const data = Input.parse({ query, translation });
  return runSearch(data.query, data.translation ?? DEFAULT_TRANSLATION);
}

/**
 * Finds real Bible verses matching a plain-language description.
 * The model only proposes references; every verse shown is fetched from the
 * configured Bible source and dropped if it does not resolve.
 */
export const searchScripture = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<ScriptureSearchResponse> => {
    const translation = resolveTranslation(data.translation ?? DEFAULT_TRANSLATION).code;
    const key = cacheKey(data.query, translation);
    const cached = cache.get(key);
    if (cached && !data.indexed?.length) return cached;

    const caller =
      getRequestHeader("cf-connecting-ip") ?? getRequestIP({ xForwardedFor: true }) ?? "unknown";
    if (!withinRateLimit(caller)) {
      return {
        results: [],
        failed: true,
        errorMessage: "Too many searches just now. Wait a moment and try again.",
      };
    }

    const response = await runSearch(data.query, translation, data.indexed);
    // Client-supplied hints cannot poison the shared query cache.
    if (!response.failed && !data.indexed?.length) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, response);
    }
    return response;
  });
