import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NARRATOR_TONE,
  NarrationEngine,
  type SpeechSettings,
  type SynthLike,
  type UtteranceLike,
} from "./engine";
import { chapterQueue, singleQueue } from "./queue";

/** A stand-in for speechSynthesis that records what was spoken and lets a test finish or fail it. */
class FakeSynth implements SynthLike {
  spoken: UtteranceLike[] = [];
  cancelled = 0;
  speak = (utterance: UtteranceLike) => {
    this.spoken.push(utterance);
  };
  cancel = () => {
    this.cancelled += 1;
  };
  get current(): UtteranceLike {
    const last = this.spoken[this.spoken.length - 1];
    if (!last) throw new Error("nothing spoken");
    return last;
  }
  finish() {
    this.current.onend?.();
  }
  fail(error: string) {
    this.current.onerror?.({ error });
  }
}

const chapter = chapterQueue({
  id: "reader",
  translation: "KJAV",
  bookId: "psalms",
  bookName: "Psalm",
  chapter: 23,
  verses: [
    { verse: 1, text: "The LORD is my shepherd" },
    { verse: 2, text: "He maketh me to lie down" },
  ],
});

let synth: FakeSynth;
let settings: SpeechSettings;
let onError: ReturnType<typeof vi.fn<(message: string) => void>>;
let engine: NarrationEngine;

beforeEach(() => {
  synth = new FakeSynth();
  settings = { rate: 1, pitch: 1, lang: "en-US", voice: null };
  onError = vi.fn<(message: string) => void>();
  engine = new NarrationEngine({
    getSynth: () => synth,
    createUtterance: (text) => ({
      text,
      rate: 0,
      pitch: 0,
      lang: "",
      voice: null,
      onend: null,
      onerror: null,
    }),
    getSettings: () => settings,
    onError,
  });
});

describe("reading a chapter", () => {
  it("reads the title, then each verse in order, and ends idle", () => {
    engine.play(chapter);
    expect(synth.current.text).toBe("Psalm 23");
    expect(engine.getState()).toMatchObject({ status: "playing", index: 0, verse: null, total: 3 });

    synth.finish();
    expect(synth.current.text).toBe("The LORD is my shepherd");
    expect(engine.getState()).toMatchObject({ index: 1, verse: 1 });

    synth.finish();
    expect(synth.current.text).toBe("He maketh me to lie down");
    expect(engine.getState().verse).toBe(2);

    synth.finish();
    expect(engine.getState().status).toBe("idle");
    expect(synth.spoken).toHaveLength(3);
  });

  it("applies the current speed, pitch, language and voice to each verse as it starts", () => {
    const voice = { voiceURI: "gb", name: "Daniel", lang: "en-GB", localService: true };
    settings = { rate: 0.85, pitch: 0.9, lang: "en-GB", voice };
    engine.play(chapter);
    expect(synth.current).toMatchObject({ rate: 0.85, pitch: 0.9, lang: "en-GB", voice });

    settings = { rate: 1.25, pitch: 1.1, lang: "en-US", voice: null };
    synth.finish();
    expect(synth.current).toMatchObject({ rate: 1.25, pitch: 1.1, lang: "en-US", voice: null });
  });

  it("starts from a chosen verse", () => {
    engine.play(chapter, 2);
    expect(synth.current.text).toBe("He maketh me to lie down");
    expect(engine.getState().verse).toBe(2);
  });
});

describe("controls", () => {
  it("pauses on the current item and resumes it from its start", () => {
    engine.play(chapter, 1);
    engine.pause();
    expect(engine.getState()).toMatchObject({ status: "paused", index: 1 });
    expect(synth.cancelled).toBeGreaterThan(0);

    // The cancelled utterance reports back late; that must not move or fail the reading.
    synth.finish();
    expect(engine.getState()).toMatchObject({ status: "paused", index: 1 });

    const spokenBefore = synth.spoken.length;
    engine.resume();
    expect(engine.getState().status).toBe("playing");
    expect(synth.spoken).toHaveLength(spokenBefore + 1);
    expect(synth.current.text).toBe("The LORD is my shepherd");
  });

  it("moves to the next and previous verse, playing or paused", () => {
    engine.play(chapter, 1);
    engine.next();
    expect(synth.current.text).toBe("He maketh me to lie down");
    engine.previous();
    expect(synth.current.text).toBe("The LORD is my shepherd");

    engine.pause();
    const spoken = synth.spoken.length;
    engine.next();
    expect(engine.getState()).toMatchObject({ status: "paused", index: 2 });
    expect(synth.spoken).toHaveLength(spoken);
  });

  it("stays on the first item when going back past the start, and stops after the last", () => {
    engine.play(chapter, 0);
    engine.previous();
    expect(engine.getState()).toMatchObject({ status: "playing", index: 0 });
    engine.play(chapter, 2);
    engine.next();
    expect(engine.getState().status).toBe("idle");
  });

  it("stop returns to idle and ignores a late callback from the old utterance", () => {
    engine.play(chapter);
    engine.stop();
    expect(engine.getState()).toMatchObject({ status: "idle", queueId: null });
    synth.finish();
    expect(engine.getState().status).toBe("idle");
    expect(synth.spoken).toHaveLength(1);
  });

  it("starting something new replaces the current reading so two never overlap", () => {
    engine.play(chapter);
    engine.play(singleQueue("other", "Another verse"));
    expect(engine.getState()).toMatchObject({ queueId: "other", total: 1 });
    expect(synth.current.text).toBe("Another verse");
    // The first reading's utterance finishing late must not advance anything.
    synth.spoken[0]?.onend?.();
    expect(synth.spoken).toHaveLength(2);
  });

  it("stopIfOwnedBy only stops a reading that screen started", () => {
    engine.play(singleQueue("screen-a", "A verse"));
    engine.stopIfOwnedBy("screen-b");
    expect(engine.getState().status).toBe("playing");
    engine.stopIfOwnedBy("screen-a");
    expect(engine.getState().status).toBe("idle");
  });
});

describe("failures and interruptions", () => {
  it("treats an interruption (a call, another app) as a pause, not an error", () => {
    engine.play(chapter, 1);
    synth.fail("interrupted");
    expect(engine.getState()).toMatchObject({ status: "paused", index: 1 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a real speech error once and stops", () => {
    engine.play(chapter);
    synth.fail("synthesis-failed");
    expect(engine.getState().status).toBe("idle");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("says so when the device cannot speak", () => {
    const silent = new NarrationEngine({
      getSynth: () => null,
      createUtterance: () => {
        throw new Error("not used");
      },
      getSettings: () => settings,
      onError,
    });
    expect(silent.supported).toBe(false);
    expect(silent.play(chapter)).toBe(false);
    expect(onError).toHaveBeenCalledWith("Listening isn't available on this device");
  });

  it("notifies subscribers when the state changes", () => {
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.play(chapter);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    engine.stop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("narrator tone", () => {
  it("keeps the three styles as pitch and pace presets", () => {
    expect(NARRATOR_TONE.classic).toEqual({ pitch: 0.9, pace: 1 });
    expect(NARRATOR_TONE.gentle.pace).toBeLessThan(1);
    expect(NARRATOR_TONE.peaceful.pace).toBeLessThan(NARRATOR_TONE.gentle.pace);
  });
});
