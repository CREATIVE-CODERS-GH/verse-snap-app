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
    "([a-z]+(?:\\s+of\\s+[a-z]+){0,2})", // book word(s), e.g. "song of solomon"
    "\\s*",
    "(?:chapter\\s*)?",
    "(\\d{1,3})", // chapter
    "(?:\\s*(?::|\\.|v|verse|verses|\\s)\\s*(\\d{1,3}))?", // optional verse
  ].join(""),
  "gi",
);

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
  const cleaned = text.replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ");
  const found = new Map<string, FoundReference>();

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

  return [...found.values()];
}
