/** Saved reading preferences: their types, defaults and the validating reader (no React). */
export type TextSize = "small" | "medium" | "large" | "xlarge";
export type Theme = "light" | "dark" | "system";

export interface Preferences {
  textSize: TextSize;
  theme: Theme;
  translation: string;
  playbackSpeed: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: "medium",
  theme: "system",
  translation: "KJAV",
  playbackSpeed: "1x",
};

const TEXT_SIZES: readonly TextSize[] = ["small", "medium", "large", "xlarge"];
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const PLAYBACK_SPEEDS = ["0.75x", "1x", "1.25x", "1.5x"];

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
  return {
    textSize: TEXT_SIZES.includes(parsed.textSize as TextSize)
      ? (parsed.textSize as TextSize)
      : DEFAULT_PREFERENCES.textSize,
    theme: THEMES.includes(parsed.theme as Theme)
      ? (parsed.theme as Theme)
      : DEFAULT_PREFERENCES.theme,
    translation,
    playbackSpeed: PLAYBACK_SPEEDS.includes(parsed.playbackSpeed as string)
      ? (parsed.playbackSpeed as string)
      : DEFAULT_PREFERENCES.playbackSpeed,
  };
}
