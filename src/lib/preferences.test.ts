import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStoredPreferences } from "./preferences-storage";

describe("parseStoredPreferences", () => {
  it("returns null when nothing usable is stored", () => {
    expect(parseStoredPreferences(null)).toBeNull();
    expect(parseStoredPreferences("")).toBeNull();
    expect(parseStoredPreferences("not json")).toBeNull();
    expect(parseStoredPreferences("42")).toBeNull();
    expect(parseStoredPreferences("null")).toBeNull();
  });

  it("keeps valid saved values", () => {
    const raw = JSON.stringify({
      textSize: "xlarge",
      theme: "dark",
      translation: "BSB",
      playbackSpeed: "1.5x",
    });
    expect(parseStoredPreferences(raw)).toEqual({
      textSize: "xlarge",
      theme: "dark",
      translation: "BSB",
      playbackSpeed: "1.5x",
    });
  });

  it("falls back to defaults field by field for anything invalid", () => {
    const raw = JSON.stringify({
      textSize: "huge",
      theme: 3,
      translation: "",
      playbackSpeed: "9x",
    });
    expect(parseStoredPreferences(raw)).toEqual({
      textSize: "medium",
      theme: "system",
      translation: "KJAV",
      playbackSpeed: "1x",
    });
  });

  it("upgrades the old KJV code and fills in missing fields", () => {
    expect(
      parseStoredPreferences(JSON.stringify({ translation: "KJV", textSize: "large" })),
    ).toEqual({
      textSize: "large",
      theme: "system",
      translation: "KJAV",
      playbackSpeed: "1x",
    });
  });
});

describe("preference saving order", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/preferences.tsx"), "utf8");

  it("never writes before the stored values have been read", () => {
    const save =
      /useEffect\(\(\) => \{\s*if \(!ready\) return;([\s\S]*?)\}, \[prefs, ready\]\);/.exec(source);
    expect(save).not.toBeNull();
    expect(save?.[1]).toContain("localStorage.setItem");
  });

  it("reads the stored values with the validating parser", () => {
    expect(source).toContain("parseStoredPreferences(window.localStorage.getItem(STORAGE_KEY))");
  });
});
