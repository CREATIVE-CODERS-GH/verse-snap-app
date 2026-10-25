/** Saved reading preferences: their types, defaults and the validating reader (no React). */
export type TextSize = "small" | "medium" | "large" | "xlarge";
export type Theme = "light" | "dark" | "system";
/** Scripture typeface: Playfair Display (serif) or Inter (sans). */
export type Typeface = "serif" | "sans";
export type LineSpacing = "standard" | "relaxed";
export type MicSensitivity = "quiet" | "standard" | "open";
/** Read-aloud style, applied to the browser voice as pitch and pace. */
export type Narrator = "classic" | "gentle" | "peaceful";

export interface Preferences {
  textSize: TextSize;
  theme: Theme;
  translation: string;
  playbackSpeed: string;
  typeface: Typeface;
  lineSpacing: LineSpacing;
  /** Say a Verse starts listening as soon as it opens. */
  autoListen: boolean;
  /** BCP 47 language tag for speech recognition. */
  speechLanguage: string;
  micSensitivity: MicSensitivity;
  narrator: Narrator;
}

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: "medium",
  theme: "system",
  translation: "KJAV",
  playbackSpeed: "1x",
  typeface: "serif",
  lineSpacing: "relaxed",
  autoListen: true,
  speechLanguage: "en-US",
  micSensitivity: "standard",
  narrator: "classic",
};

const TEXT_SIZES: readonly TextSize[] = ["small", "medium", "large", "xlarge"];
const THEMES: readonly Theme[] = ["light", "dark", "system"];
export const PLAYBACK_SPEEDS = ["0.75x", "1x", "1.25x", "1.5x"];
const TYPEFACES: readonly Typeface[] = ["serif", "sans"];
const LINE_SPACINGS: readonly LineSpacing[] = ["standard", "relaxed"];
const MIC_SENSITIVITIES: readonly MicSensitivity[] = ["quiet", "standard", "open"];
const NARRATORS: readonly Narrator[] = ["classic", "gentle", "peaceful"];

/** Speech-recognition languages offered in Voice & Audio settings. */
export const SPEECH_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-GH", label: "English (Ghana)" },
  { code: "en-NG", label: "English (Nigeria)" },
  { code: "en-KE", label: "English (Kenya)" },
  { code: "en-ZA", label: "English (South Africa)" },
  { code: "en-IN", label: "English (India)" },
  { code: "en-AU", label: "English (Australia)" },
];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Reads saved preferences from the raw stored text. Anything missing, unreadable or not one of the
 * allowed values falls back to its default, so a damaged entry can never put the app in a bad state.
 * Returns null when nothing is stored.
 */
export function parseStoredPreferences(raw: string | null): Preferences | null {
  if (!raw) return null;
  let parsed: Partial<Record<keyof Preferences, unknown>>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    parsed = value as typeof parsed;
  } catch {
    return null;
  }
  const translation =
    parsed.translation === "KJV"
      ? "KJAV"
      : typeof parsed.translation === "string" && parsed.translation
        ? parsed.translation
        : DEFAULT_PREFERENCES.translation;
  const d = DEFAULT_PREFERENCES;
  return {
    textSize: oneOf(parsed.textSize, TEXT_SIZES, d.textSize),
    theme: oneOf(parsed.theme, THEMES, d.theme),
    translation,
    playbackSpeed: oneOf(parsed.playbackSpeed, PLAYBACK_SPEEDS, d.playbackSpeed),
    typeface: oneOf(parsed.typeface, TYPEFACES, d.typeface),
    lineSpacing: oneOf(parsed.lineSpacing, LINE_SPACINGS, d.lineSpacing),
    autoListen: typeof parsed.autoListen === "boolean" ? parsed.autoListen : d.autoListen,
    speechLanguage: oneOf(
      parsed.speechLanguage,
      SPEECH_LANGUAGES.map((item) => item.code),
      d.speechLanguage,
    ),
    micSensitivity: oneOf(parsed.micSensitivity, MIC_SENSITIVITIES, d.micSensitivity),
    narrator: oneOf(parsed.narrator, NARRATORS, d.narrator),
  };
}
