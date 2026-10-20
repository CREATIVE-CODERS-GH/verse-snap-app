/**
 * Choices offered by the Reflection Journal (Stitch Screen 24).
 *
 * NOT CONNECTED TO A SOURCE. The theme and suggested tags for Romans 12:2 are the approved design's
 * sample copy; every other verse gets general suggestions and no theme. Notebooks are placeholders
 * until the journal has storage, so they carry no counts. The interface labels all of this as a
 * preview. No verse text lives here.
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

export interface Notebook {
  id: string;
  name: string;
}

export const SAMPLE_NOTEBOOKS: readonly Notebook[] = [
  { id: "general", name: "General Reflections" },
  { id: "daily-renewal", name: "Daily Renewal (Romans Study)" },
  { id: "prayer", name: "Prayer Journal" },
  { id: "sermon", name: "Sermon Notes" },
];

export interface ReflectionSuggestions {
  /** Shown under the verse ("Theme: …"); null when there is no sample theme for the verse. */
  theme: string | null;
  tags: string[];
  /** The notebook the design pre-selects for this verse. */
  notebookId: string;
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
      notebookId: "daily-renewal",
    };
  }
  return { theme: null, tags: GENERAL_TAGS, notebookId: "general" };
}
