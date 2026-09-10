import { parseReference, type ParsedReference } from "./parse-reference";

export interface FoundReference extends ParsedReference {
  /** The raw text the reference was recognised from. */
  raw: string;
  /** True when the text used an explicit chapter/verse separator such as ":" or "verse". */
  explicit: boolean;
}

/**
 * Matches candidate references inside free-form text, e.g.
 * "John 3:16", "1 Cor 13.4", "Second Timothy chapter 1 verse 7", "Ps 23".
 */
const CANDIDATE = new RegExp(
  [
    "\\b",
    "((?:[1-3]|i{1,3}|first|second|third)\\s*)?", // optional book number
    "([a-z0-9]+(?:\\s+of\\s+[a-z0-9]+){0,2})", // tolerate OCR substitutions
    "\\s*",
    "(?:chapter\\s*)?",
    "(\\d{1,3})", // chapter
    "(?:\\s*(?::|;|\\.|-|v|verse|verses|\\s)\\s*(\\d{1,3}))?", // optional verse
  ].join(""),
  "gi",
);

/** Repairs common OCR separators and number glyphs without guessing verse text. */
export function normaliseOcrText(text: string): string {
  return text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[|]/g, "1")
    .replace(/(\d)\s*[,;.]\s*(\d)/g, "$1:$2")
    .replace(/\b([A-Za-z]{2,})(?=\d{1,3}(?:\D|$))/g, "$1 ")
    .replace(/\b([0-9]{1,3})\s*[oO]\s*([0-9]{1,3})\b/g, "$1 0 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function keyOf(reference: ParsedReference): string {
  return `${reference.bookId}-${reference.chapter}-${reference.verse ?? "c"}`;
}

/**
 * Scans arbitrary text (such as OCR output) and returns every distinct Bible
 * reference it contains, in the order they appear. Text that is not a
 * reference is ignored; nothing is guessed.
 */
export function findReferences(text: string, limit = 5): FoundReference[] {
  if (!text) return [];
  const cleaned = normaliseOcrText(text);
  const found = new Map<string, FoundReference>();

  const wholeReference = parseReference(cleaned);
  if (wholeReference) {
    found.set(keyOf(wholeReference), {
      ...wholeReference,
      raw: cleaned,
      explicit: /[:;.-]|\bv(?:erse)?s?\b/i.test(cleaned),
    });
  }

  CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE.exec(cleaned)) !== null) {
    const raw = match[0].trim();
    const reference = parseReference(raw);
    if (!reference) continue;
    const key = keyOf(reference);
    if (found.has(key)) continue;
    found.set(key, {
      ...reference,
      raw,
      explicit: /[:.]|\bv(?:erse)?s?\b/i.test(raw),
    });
    if (found.size >= limit) break;
  }

  // A sliding token pass recovers references from noisy OCR where punctuation
  // disappeared or a book name contains one substituted character.
  const tokens = cleaned.match(/[A-Za-z0-9]+|[:;.-]/g) ?? [];
  for (let start = 0; start < tokens.length && found.size < limit; start += 1) {
    for (let end = Math.min(tokens.length, start + 8); end >= start + 2; end -= 1) {
      const raw = tokens.slice(start, end).join(" ");
      const reference = parseReference(raw);
      if (!reference) continue;
      const key = keyOf(reference);
      if (!found.has(key)) {
        found.set(key, {
          ...reference,
          raw,
          explicit: /[:;.-]|\bv(?:erse)?s?\b/i.test(raw),
        });
      }
      break;
    }
  }

  return [...found.values()].sort((left, right) => {
    if (left.verse !== undefined && right.verse === undefined) return -1;
    if (left.verse === undefined && right.verse !== undefined) return 1;
    return 0;
  });
}
