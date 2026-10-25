import { beforeEach, describe, expect, it, vi } from "vitest";

// The real SDK is replaced, so these tests can only inspect how the client is configured.
const constructed = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    responses = { create: vi.fn() };
    constructor(options: unknown) {
      constructed.options.push(options);
    }
  },
}));

import { REQUEST_TIMEOUT_MS, createOpenAiClient } from "./openai.server";
import { createProvider } from "./index.server";
import { readAiSearchConfig } from "../config.server";

beforeEach(() => {
  constructed.options.length = 0;
});

describe("createOpenAiClient", () => {
  it("disables automatic retries (each retry would be another paid request) and sets a short timeout", () => {
    createOpenAiClient("sk-fake-key-for-test");
    expect(constructed.options).toEqual([
      { apiKey: "sk-fake-key-for-test", timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    ]);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("createProvider", () => {
  const config = readAiSearchConfig({ AI_SEARCH_ENABLED: "true" });

  it("builds the OpenAI provider only when the key is present", () => {
    expect(createProvider(config, {})).toBeNull();
    expect(createProvider(config, { OPENAI_API_KEY: "   " })).toBeNull();
    expect(createProvider(config, { OPENAI_API_KEY: "sk-fake" })?.id).toBe("openai");
  });

  it("returns null for an unknown or disabled provider and never builds a fallback", () => {
    for (const provider of ["disabled", "unknown", "anthropic", ""]) {
      expect(createProvider({ ...config, provider }, { OPENAI_API_KEY: "sk-fake" })).toBeNull();
    }
    expect(constructed.options).toHaveLength(0);
  });

  it("reads the key from the environment it is given, not from the config", () => {
    createProvider(config, { OPENAI_API_KEY: "sk-from-env" });
    expect(constructed.options).toEqual([expect.objectContaining({ apiKey: "sk-from-env" })]);
    expect(JSON.stringify(config)).not.toContain("sk-from-env");
  });
});
