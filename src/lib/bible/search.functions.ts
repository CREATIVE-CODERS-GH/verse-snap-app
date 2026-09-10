import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseReference } from "./parse-reference";
import { bibleService, DEFAULT_TRANSLATION } from "./service";
import type { Verse } from "./types";

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
}

const Input = z.object({
  query: z.string().min(2).max(200),
  translation: z.string().min(2).max(12).optional(),
});

const cache = new Map<string, ScriptureSearchResponse>();

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
  "People often quote modern translations while the text shown is the King James Version,",
  "so match on meaning and passage, not King James wording: for example 'love is patient'",
  "is 1 Corinthians 13:4 even though that verse reads 'charity suffereth long'.",
  "If nothing plausibly matches, return an empty list.",
].join(" ");

interface Candidate {
  book: string;
  chapter: number;
  verse: number;
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
  if (!apiKey) return [];

  const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
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

  if (!response.ok) {
    console.error("Scripture search upstream failed", response.status, await response.text());
    throw new Error("scripture-search-failed");
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
    .replace(/[^a-z0-9\s]/g, " ")
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
    const hits = words.filter((word) => text.includes(word)).length;
    value += Math.round((hits / words.length) * 40);
    if (hits === words.length) value += 20;
  }
  return value;
}

async function runSearch(query: string, translation: string): Promise<ScriptureSearchResponse> {
  let candidates: Candidate[];
  try {
    candidates = await askForCandidates(query);
  } catch {
    return { results: [], failed: true };
  }

  const seen = new Set<string>();
  const verses: Array<{ verse: Verse; order: number }> = [];

  await Promise.all(
    candidates.slice(0, MAX_CANDIDATES).map(async (candidate, order) => {
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

  return { results, failed: false };
}

/**
 * Finds real Bible verses matching a plain-language description.
 * The model only proposes references; every verse shown is fetched from the
 * configured Bible source and dropped if it does not resolve.
 */
export const searchScripture = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<ScriptureSearchResponse> => {
    const translation = data.translation ?? DEFAULT_TRANSLATION;
    const key = cacheKey(data.query, translation);
    const cached = cache.get(key);
    if (cached) return cached;

    const response = await runSearch(data.query, translation);
    if (!response.failed) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, response);
    }
    return response;
  });
