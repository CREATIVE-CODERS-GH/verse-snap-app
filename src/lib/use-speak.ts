import { useCallback, useEffect, useState } from "react";
import { trackEvent } from "./analytics";
import { usePreferences } from "./preferences";

/** Reads text aloud with the browser's voice, at the playback speed saved in Settings. */
export function useSpeak(notify?: (message: string) => void) {
  const { playbackSpeed } = usePreferences();
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
      utterance.rate = Number.parseFloat(playbackSpeed) || 1;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      trackEvent("verse_listened");
      setSpeaking(true);
    },
    [notify, playbackSpeed, speaking, stop],
  );

  return { speaking, toggle, stop };
}
