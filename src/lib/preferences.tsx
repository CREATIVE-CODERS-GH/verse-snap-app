import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_PREFERENCES as DEFAULTS,
  parseStoredPreferences,
  type Preferences,
  type TextSize,
  type Theme,
} from "./preferences-storage";

export type { Preferences, TextSize, Theme };

interface PreferencesValue extends Preferences {
  /** True once saved preferences have been read (or found absent). Do not act on `translation` before this. */
  ready: boolean;
  setTextSize: (value: TextSize) => void;
  setTheme: (value: Theme) => void;
  setTranslation: (value: string) => void;
  setPlaybackSpeed: (value: string) => void;
}

const STORAGE_KEY = "versesnap.preferences";

const PreferencesContext = createContext<PreferencesValue>({
  ...DEFAULTS,
  ready: false,
  setTextSize: () => {},
  setTheme: () => {},
  setTranslation: () => {},
  setPlaybackSpeed: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = parseStoredPreferences(window.localStorage.getItem(STORAGE_KEY));
      if (stored) setPrefs(stored);
    } catch {
      /* ignore unreadable storage */
    }
    setReady(true);
  }, []);

  // Saving waits until the stored values have been read. Before that, `prefs` still holds the
  // defaults, and writing them would overwrite what the person saved (React StrictMode in development
  // runs the effects twice, which made that overwrite happen on every reload).
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore unwritable storage */
    }
  }, [prefs, ready]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["textSize"] = prefs.textSize;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = prefs.theme === "dark" || (prefs.theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
      // Keep the installed-app / browser chrome colour in sync with the app theme.
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) themeColor.setAttribute("content", dark ? "#121212" : "#ffffff");
    };
    apply();
    // "System" follows the device when it switches between light and dark.
    if (prefs.theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs]);

  const value = useMemo<PreferencesValue>(
    () => ({
      ...prefs,
      ready,
      setTextSize: (textSize) => setPrefs((p) => ({ ...p, textSize })),
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      setTranslation: (translation) => setPrefs((p) => ({ ...p, translation })),
      setPlaybackSpeed: (playbackSpeed) => setPrefs((p) => ({ ...p, playbackSpeed })),
    }),
    [prefs, ready],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
