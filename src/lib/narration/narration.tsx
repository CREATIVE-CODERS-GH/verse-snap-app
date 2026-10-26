import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { usePreferences } from "../preferences";
import {
  IDLE_STATE,
  NARRATOR_TONE,
  NarrationEngine,
  type NarrationState,
  type SpeechSettings,
  type SynthLike,
  type UtteranceLike,
} from "./engine";
import type { NarrationQueue } from "./queue";
import { listVoices, resolveVoice, type VoiceLike, type VoiceOption } from "./voices";

interface NarrationValue {
  state: NarrationState;
  /** False when this device has no speech synthesis. */
  supported: boolean;
  play: (queue: NarrationQueue, startIndex?: number) => boolean;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  stopIfOwnedBy: (id: string) => void;
}

const NarrationContext = createContext<NarrationValue | null>(null);

function browserSynth(): (SynthLike & { getVoices: () => VoiceLike[] }) | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return null;
  return window.speechSynthesis as unknown as SynthLike & { getVoices: () => VoiceLike[] };
}

/**
 * Owns the one narration engine for the whole app, above the routes, so reading aloud is not cut
 * off by moving between screens and two buttons can never speak over each other.
 */
export function NarrationProvider({ children }: { children: ReactNode }) {
  const preferences = usePreferences();
  const settingsSource = useRef(preferences);
  settingsSource.current = preferences;

  const [engine] = useState(
    () =>
      new NarrationEngine({
        getSynth: browserSynth,
        createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
        getSettings: (): SpeechSettings => {
          const { playbackSpeed, narrator, voiceURI, speechLanguage } = settingsSource.current;
          const tone = NARRATOR_TONE[narrator] ?? NARRATOR_TONE.classic;
          const voice = resolveVoice(browserSynth()?.getVoices() ?? [], voiceURI);
          return {
            rate: (Number.parseFloat(playbackSpeed) || 1) * tone.pace,
            pitch: tone.pitch,
            // A chosen voice sets its own language; otherwise the accent chosen in Settings.
            lang: voice?.lang ?? speechLanguage,
            voice,
          };
        },
        onError: (message) => toast(message),
      }),
  );

  const state = useSyncExternalStore(engine.subscribe, engine.getState, () => IDLE_STATE);

  // Leaving the page (switching apps, locking the screen) pauses at the current verse. Whether
  // speech could carry on in the background differs by browser and has not been verified.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") engine.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [engine]);

  useEffect(() => () => engine.stop(), [engine]);

  // The controls never change identity, so effects that depend on them do not re-run (and cancel
  // speech) every time the reading moves to the next verse.
  const controls = useMemo(
    () => ({
      play: (queue: NarrationQueue, startIndex?: number) => engine.play(queue, startIndex),
      pause: () => engine.pause(),
      resume: () => engine.resume(),
      stop: () => engine.stop(),
      next: () => engine.next(),
      previous: () => engine.previous(),
      stopIfOwnedBy: (id: string) => engine.stopIfOwnedBy(id),
    }),
    [engine],
  );

  const value = useMemo<NarrationValue>(
    () => ({ state, supported: engine.supported, ...controls }),
    [engine, state, controls],
  );

  return <NarrationContext.Provider value={value}>{children}</NarrationContext.Provider>;
}

const FALLBACK: NarrationValue = {
  state: IDLE_STATE,
  supported: false,
  play: () => false,
  pause: () => {},
  resume: () => {},
  stop: () => {},
  next: () => {},
  previous: () => {},
  stopIfOwnedBy: () => {},
};

export function useNarration(): NarrationValue {
  return useContext(NarrationContext) ?? FALLBACK;
}

/** Voices installed on this device, kept up to date (some browsers load them after the page). */
export function useDeviceVoices(): VoiceOption[] {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  useEffect(() => {
    const synth = browserSynth();
    if (!synth) return;
    const read = () => setVoices(listVoices(synth.getVoices()));
    read();
    const target = window.speechSynthesis;
    target.addEventListener("voiceschanged", read);
    return () => target.removeEventListener("voiceschanged", read);
  }, []);
  return voices;
}
