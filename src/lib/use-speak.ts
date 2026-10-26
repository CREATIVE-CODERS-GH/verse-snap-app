import { useCallback, useEffect, useId } from "react";
import { trackEvent } from "./analytics";
import { NARRATOR_TONE } from "./narration/engine";
import { useNarration } from "./narration/narration";
import { singleQueue } from "./narration/queue";

export { NARRATOR_TONE };

/**
 * Reads one piece of text aloud through the app's single narration engine, using the narrator,
 * voice and playback speed saved in Settings. Starting it replaces anything else being read, and
 * leaving the screen stops only what this screen started.
 */
export function useSpeak(notify?: (message: string) => void) {
  const ownerId = useId();
  const narration = useNarration();
  const { state, supported, stopIfOwnedBy } = narration;

  const speaking = state.queueId === ownerId && state.status === "playing";

  const stop = useCallback(() => stopIfOwnedBy(ownerId), [stopIfOwnedBy, ownerId]);

  useEffect(() => () => stopIfOwnedBy(ownerId), [stopIfOwnedBy, ownerId]);

  const toggle = useCallback(
    (text: string) => {
      if (!supported) {
        notify?.("Listening isn't available on this device");
        return;
      }
      if (speaking) {
        stop();
        return;
      }
      if (narration.play(singleQueue(ownerId, text))) trackEvent("verse_listened");
    },
    [supported, speaking, stop, narration, ownerId, notify],
  );

  return { speaking, toggle, stop };
}
