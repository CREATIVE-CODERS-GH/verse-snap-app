import type { Narrator } from "../preferences-storage";
import { stepIndex, type NarrationQueue } from "./queue";
import type { VoiceLike } from "./voices";

/** Narrator styles from Settings → Voice & Audio, applied to the device voice as pitch and pace. */
export const NARRATOR_TONE: Record<Narrator, { pitch: number; pace: number }> = {
  classic: { pitch: 0.9, pace: 1 },
  gentle: { pitch: 1.1, pace: 0.95 },
  peaceful: { pitch: 1, pace: 0.85 },
};

/** The slice of a speech utterance the engine uses (real ones from the browser fit this shape). */
export interface UtteranceLike {
  text: string;
  rate: number;
  pitch: number;
  lang: string;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

/** The slice of `window.speechSynthesis` the engine uses. */
export interface SynthLike {
  speak: (utterance: UtteranceLike) => void;
  cancel: () => void;
}

export interface SpeechSettings {
  rate: number;
  pitch: number;
  lang: string;
  voice: VoiceLike | null;
}

export type NarrationStatus = "idle" | "playing" | "paused";

export interface NarrationState {
  status: NarrationStatus;
  /** Who started the current reading (see `NarrationQueue.id`); null when idle. */
  queueId: string | null;
  label: string;
  chapter: NarrationQueue["chapter"];
  /** Position in the queue; the item being read (or paused on). */
  index: number;
  total: number;
  /** The verse being read, or null for the chapter title or a plain text reading. */
  verse: number | null;
}

export const IDLE_STATE: NarrationState = {
  status: "idle",
  queueId: null,
  label: "",
  chapter: null,
  index: 0,
  total: 0,
  verse: null,
};

export interface EngineOptions {
  /** Looked up on every call, because the device may not have speech (or the page may be on the server). */
  getSynth: () => SynthLike | null;
  createUtterance: (text: string) => UtteranceLike;
  /** Read at the moment each item starts, so changing speed, narrator or voice applies from the next verse. */
  getSettings: () => SpeechSettings;
  onError?: (message: string) => void;
}

/**
 * Reads a queue aloud, one utterance per item, and keeps the reading's state. There is one engine
 * for the whole app, so only one thing is ever spoken at a time.
 *
 * Pausing cancels the current utterance and remembers the position: resuming reads the current item
 * again from its start. That is deliberate, because `speechSynthesis.pause()` is unreliable on some
 * mobile browsers, and it behaves the same everywhere.
 */
export class NarrationEngine {
  private state: NarrationState = IDLE_STATE;
  private queue: NarrationQueue | null = null;
  private listeners = new Set<() => void>();
  /** Bumped whenever the current utterance is replaced; stale callbacks compare against it and stop. */
  private token = 0;

  constructor(private readonly options: EngineOptions) {}

  getState = (): NarrationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** True when this device can speak at all. */
  get supported(): boolean {
    return this.options.getSynth() !== null;
  }

  /** Starts reading `queue` from `startIndex`, replacing anything already being read. */
  play(queue: NarrationQueue, startIndex = 0): boolean {
    const synth = this.options.getSynth();
    if (!synth) {
      this.options.onError?.("Listening isn't available on this device");
      return false;
    }
    if (queue.items.length === 0) return false;
    this.token += 1;
    synth.cancel();
    this.queue = queue;
    this.setState({
      ...this.positionOf(queue, clamp(startIndex, queue.items.length)),
      status: "playing",
    });
    this.speakCurrent();
    return true;
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.token += 1;
    this.options.getSynth()?.cancel();
    this.setState({ ...this.state, status: "paused" });
  }

  resume(): void {
    if (this.state.status !== "paused" || !this.queue) return;
    this.setState({ ...this.state, status: "playing" });
    this.speakCurrent();
  }

  stop(): void {
    if (this.state.status === "idle") return;
    this.token += 1;
    this.options.getSynth()?.cancel();
    this.queue = null;
    this.setState(IDLE_STATE);
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  /** Stops only if `id` started the current reading (a screen cleaning up must not cut off someone else's). */
  stopIfOwnedBy(id: string): void {
    if (this.state.queueId === id) this.stop();
  }

  private step(direction: 1 | -1): void {
    const queue = this.queue;
    if (!queue || this.state.status === "idle") return;
    const index = stepIndex(queue, this.state.index, direction);
    if (index === null) {
      if (direction === 1) this.stop();
      return;
    }
    const playing = this.state.status === "playing";
    this.token += 1;
    this.options.getSynth()?.cancel();
    this.setState({ ...this.positionOf(queue, index), status: this.state.status });
    if (playing) this.speakCurrent();
  }

  private speakCurrent(): void {
    const queue = this.queue;
    const synth = this.options.getSynth();
    if (!queue || !synth) return;
    const item = queue.items[this.state.index];
    if (!item) {
      this.stop();
      return;
    }
    const token = ++this.token;
    const settings = this.options.getSettings();
    const utterance = this.options.createUtterance(item.text);
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.lang = settings.lang;
    utterance.voice = settings.voice;
    utterance.onend = () => {
      if (token !== this.token) return;
      const index = stepIndex(queue, this.state.index, 1);
      if (index === null) {
        this.stop();
        return;
      }
      this.setState({ ...this.positionOf(queue, index), status: "playing" });
      this.speakCurrent();
    };
    utterance.onerror = (event) => {
      if (token !== this.token) return;
      // Another app or a call took the audio: stay on this item so the person can resume.
      if (event.error === "interrupted" || event.error === "canceled") {
        this.setState({ ...this.state, status: "paused" });
        return;
      }
      this.stop();
      this.options.onError?.("Couldn't read this aloud. Try again.");
    };
    synth.speak(utterance);
  }

  private positionOf(queue: NarrationQueue, index: number): NarrationState {
    return {
      status: this.state.status,
      queueId: queue.id,
      label: queue.label,
      chapter: queue.chapter,
      index,
      total: queue.items.length,
      verse: queue.items[index]?.verse ?? null,
    };
  }

  private setState(next: NarrationState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}
