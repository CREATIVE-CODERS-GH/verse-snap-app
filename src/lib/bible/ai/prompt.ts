// Provider-neutral prompt and output schema for reference identification.
// Moved verbatim from search.functions.ts. The schema is a strict JSON Schema
// (all properties required, additionalProperties false) accepted by OpenAI structured outputs.

/** Most candidate references requested from a provider. */
export const MAX_CANDIDATES = 12;
/** Most verses returned to the browser. */
export const MAX_RESULTS = 8;

export const SCHEMA = {
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

export const SYSTEM_PROMPT = [
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
