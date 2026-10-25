import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, readAiSearchConfig } from "./config.server";

describe("readAiSearchConfig", () => {
  it("is OFF by default with the cheap development configuration", () => {
    const config = readAiSearchConfig({});
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-6-luna");
    expect(config.effort).toBe("none");
    expect(config.limits).toEqual(DEFAULT_LIMITS);
  });

  it("turns on only for the exact value 'true'", () => {
    for (const value of ["true", "TRUE", " true "]) {
      expect(readAiSearchConfig({ AI_SEARCH_ENABLED: value }).enabled).toBe(true);
    }
    for (const value of ["", "1", "yes", "on", "false", "truee", undefined]) {
      expect(readAiSearchConfig({ AI_SEARCH_ENABLED: value }).enabled).toBe(false);
    }
  });

  it("reads provider, model and effort overrides", () => {
    const config = readAiSearchConfig({
      AI_PROVIDER: "OpenAI",
      AI_SEARCH_MODEL: "some-model",
      AI_SEARCH_EFFORT: "Low",
    });
    expect(config).toMatchObject({ provider: "openai", model: "some-model", effort: "low" });
  });

  it("ignores an unknown effort and keeps the default", () => {
    expect(readAiSearchConfig({ AI_SEARCH_EFFORT: "turbo" }).effort).toBe("none");
  });

  it("reads limit overrides and ignores invalid ones", () => {
    const config = readAiSearchConfig({
      AI_LIMIT_GUEST_MINUTE: "5",
      AI_LIMIT_GUEST_DAY: "0",
      AI_LIMIT_USER_MINUTE: "-3",
      AI_LIMIT_USER_DAY: "lots",
      AI_LIMIT_GLOBAL_DAY: "1000",
      AI_LIMIT_GLOBAL_MONTH: "12.5",
    });
    expect(config.limits).toEqual({
      ...DEFAULT_LIMITS,
      guestMinute: 5,
      globalDay: 1000,
    });
  });
});
