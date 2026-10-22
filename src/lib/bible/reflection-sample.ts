/**
 * Choices offered by the Reflection Journal (Stitch Screen 24).
 *
 * NOT CONNECTED TO A SOURCE. The theme and suggested tags for Romans 12:2 are the approved design's
 * sample copy; every other verse gets general suggestions and no theme. The interface labels the
 * theme as a sample. Notebooks are real now (src/lib/journal.ts). No verse text lives here.
 */

export interface SpiritualPosture {
  id: string;
  label: string;
}

export const SPIRITUAL_POSTURES: readonly SpiritualPosture[] = [
  { id: "attentive", label: "Attentive & Hopeful" },
  { id: "grateful", label: "Grateful" },
  { id: "peaceful", label: "Peaceful & Still" },
  { id: "joyful", label: "Joyful" },
  { id: "searching", label: "Searching & Curious" },
  { id: "burdened", label: "Burdened" },
  { id: "repentant", label: "Repentant" },
];

export interface ReflectionSuggestions {
  /** Shown under the verse ("Theme: …"); null when there is no sample theme for the verse. */
  theme: string | null;
  tags: string[];
}

const GENERAL_TAGS = ["#Faith", "#Prayer", "#Gratitude", "#Surrender"];

export function getReflectionSuggestions(
  bookId: string,
  chapter: number,
  verse: number,
): ReflectionSuggestions {
  if (bookId === "romans" && chapter === 12 && verse === 2) {
    return {
      theme: "Transformation & Discernment",
      tags: ["#MindRenewal", "#SpiritualGrowth", "#Surrender", "#PurityOfMind"],
    };
  }
  return { theme: null, tags: GENERAL_TAGS };
}
