import { useCallback, useEffect, useState } from "react";
import { trackEvent } from "./analytics";
import { usePreferences, type Narrator } from "./preferences";

/** Narrator styles from Settings → Voice & Audio, applied to the browser voice. */
export const NARRATOR_TONE: Record<Narrator, { pitch: number; pace: number }> = {
  classic: { pitch: 0.9, pace: 1 },
  gentle: { pitch: 1.1, pace: 0.95 },
  peaceful: { pitch: 1, pace: 0.85 },
};

/** Reads text aloud with the browser's voice, at the playback speed saved in Settings. */
export function useSpeak(notify?: (message: string) => void) {
  const { playbackSpeed, narrator } = usePreferences();
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const toggle = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
        notify?.("Listening isn't available on this device");
        return;
      }
      if (speaking) {
        stop();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const tone = NARRATOR_TONE[narrator] ?? NARRATOR_TONE.classic;
      utterance.rate = (Number.parseFloat(playbackSpeed) || 1) * tone.pace;
      utterance.pitch = tone.pitch;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      trackEvent("verse_listened");
      setSpeaking(true);
    },
    [notify, playbackSpeed, narrator, speaking, stop],
  );

  return { speaking, toggle, stop };
}
