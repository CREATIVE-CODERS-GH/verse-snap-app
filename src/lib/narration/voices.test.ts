import { describe, expect, it } from "vitest";
import { listVoices, resolveVoice, voiceLabel, type VoiceLike } from "./voices";

const voice = (voiceURI: string, name: string, lang: string): VoiceLike => ({
  voiceURI,
  name,
  lang,
  localService: true,
});

const installed = [
  voice("fr", "Amélie", "fr-CA"),
  voice("us-2", "Zoe", "en-US"),
  voice("gb", "Daniel", "en-GB"),
  voice("us-1", "Alex", "en-US"),
];

describe("listVoices", () => {
  it("lists English voices first, each group A to Z", () => {
    expect(listVoices(installed).map((item) => item.name)).toEqual([
      "Alex",
      "Daniel",
      "Zoe",
      "Amélie",
    ]);
  });

  it("does not change the list it was given", () => {
    const copy = [...installed];
    listVoices(installed);
    expect(installed).toEqual(copy);
  });

  it("labels a voice with its language", () => {
    expect(voiceLabel({ uri: "gb", name: "Daniel", lang: "en-GB" })).toBe("Daniel (en-GB)");
  });
});

describe("resolveVoice", () => {
  it("finds the saved voice", () => {
    expect(resolveVoice(installed, "gb")?.name).toBe("Daniel");
  });

  it("falls back to Automatic when nothing is saved or the voice is gone", () => {
    expect(resolveVoice(installed, "")).toBeNull();
    expect(resolveVoice(installed, "removed-voice")).toBeNull();
    expect(resolveVoice([], "gb")).toBeNull();
  });
});
