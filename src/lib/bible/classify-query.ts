import { parseReference, type ParsedReference } from "./parse-reference";

export type QueryIntent =
  { kind: "reference"; reference: ParsedReference } | { kind: "description"; query: string };

/** Spoken or typed lead-ins that wrap a description, e.g. "find the verse that says …". */
const LEAD_INS = [
  /^(please\s+)?(hey\s+)?(verse\s*snap[,\s]+)?/i,
  /^(can you\s+|could you\s+)?/i,
  /^(find|show|search|open|read|tell)\s+(me\s+)?/i,
  /^(what(?:'|’)?s|what is|where(?:'|’)?s|where is|where does)\s+/i,
  /^(the\s+)?(bible\s+)?(verse|scripture|passage|chapter)\s+/i,
  /^(that\s+|which\s+|it\s+)?(says|say|goes|is about|about)\s+/i,
  /^(in the bible\s+)?/i,
];

/** Removes conversational framing so the remaining words describe the scripture. */
export function stripLeadIn(input: string): string {
  let text = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEAD_INS) {
      const next = text.replace(pattern, "");
      if (next !== text && next.trim().length > 0) {
        text = next.trim();
        changed = true;
      }
    }
  }
  return text.trim();
}

/**
 * Decides whether the user gave a Bible reference or described a verse.
 * References always win, so straightforward lookups never touch semantic search.
 */
export function classifyQuery(input: string): QueryIntent | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = parseReference(trimmed);
  if (direct) return { kind: "reference", reference: direct };

  const stripped = stripLeadIn(trimmed);
  if (stripped && stripped !== trimmed) {
    const spoken = parseReference(stripped);
    if (spoken) return { kind: "reference", reference: spoken };
  }

  const query = stripped || trimmed;
  return { kind: "description", query };
}
