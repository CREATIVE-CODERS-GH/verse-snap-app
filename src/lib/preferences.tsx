import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type TextSize = "small" | "medium" | "large" | "xlarge";
export type Theme = "light" | "dark" | "system";

interface Preferences {
  textSize: TextSize;
  theme: Theme;
  translation: string;
  playbackSpeed: string;
}

interface PreferencesValue extends Preferences {
  setTextSize: (value: TextSize) => void;
  setTheme: (value: Theme) => void;
  setTranslation: (value: string) => void;
  setPlaybackSpeed: (value: string) => void;
}

const DEFAULTS: Preferences = {
  textSize: "medium",
  theme: "system",
  translation: "KJV",
  playbackSpeed: "1x",
};

const STORAGE_KEY = "versesnap.preferences";

const PreferencesContext = createContext<PreferencesValue>({
  ...DEFAULTS,
  setTextSize: () => {},
  setTheme: () => {},
  setTranslation: () => {},
  setPlaybackSpeed: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setPrefs({ ...DEFAULTS, ...(JSON.parse(stored) as Partial<Preferences>) });
    } catch {
      /* ignore unreadable storage */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore unwritable storage */
    }
    const root = document.documentElement;
    root.dataset["textSize"] = prefs.textSize;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = prefs.theme === "dark" || (prefs.theme === "system" && prefersDark);
    root.classList.toggle("dark", dark);
  }, [prefs]);

  const value = useMemo<PreferencesValue>(
    () => ({
      ...prefs,
      setTextSize: (textSize) => setPrefs((p) => ({ ...p, textSize })),
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      setTranslation: (translation) => setPrefs((p) => ({ ...p, translation })),
      setPlaybackSpeed: (playbackSpeed) => setPrefs((p) => ({ ...p, playbackSpeed })),
    }),
    [prefs],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
