import { describe, expect, it, vi } from "vitest";
import { SCHEMA, SYSTEM_PROMPT } from "../prompt";
import { AiProviderError } from "../types";
import {
  MAX_OUTPUT_TOKENS,
  createOpenAiProvider,
  mapProviderError,
  type OpenAiClientLike,
} from "./openai.server";

const SECRET = "sk-test-SECRET-should-never-appear-anywhere-0123456789";

function clientReturning(response: unknown) {
  const create = vi.fn(
    async (_body: Record<string, unknown>, _options?: { signal?: AbortSignal }) => response,
  );
  const client: OpenAiClientLike = { responses: { create } };
  return { client, create };
}

function ok(references: unknown, extra: Record<string, unknown> = {}) {
  return {
    status: "completed",
    output_text: JSON.stringify({ references }),
    usage: {
      input_tokens: 299,
      output_tokens: 172,
      output_tokens_details: { reasoning_tokens: 0 },
    },
    ...extra,
  };
}

function provider(client: OpenAiClientLike, effort: "none" | "low" = "none") {
  return createOpenAiProvider({ model: "gpt-6-luna", effort, client });
}

describe("OpenAI provider request", () => {
  it("sends one strict structured request with the configured model and effort", async () => {
    const { client, create } = clientReturning(ok([{ book: "John", chapter: 3, verse: 16 }]));
    await provider(client, "low").findCandidates({
      query: "for God so loved the world",
      maxCandidates: 12,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      instructions: SYSTEM_PROMPT,
      input: "for God so loved the world",
      reasoning: { effort: "low" },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: {
        format: { type: "json_schema", name: "bible_references", strict: true, schema: SCHEMA },
      },
    });
  });

  it("does not send sampling parameters, tools, a fallback model, or stored conversation state", async () => {
    const { client, create } = clientReturning(ok([]));
    await provider(client).findCandidates({ query: "anything", maxCandidates: 12 });
    const body = create.mock.calls[0]![0];
    for (const key of [
      "temperature",
      "top_p",
      "tools",
      "tool_choice",
      "previous_response_id",
      "models",
      "fallbacks",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("caps the output it will pay for", () => {
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(2000);
  });

  it("forwards an abort signal when given one", async () => {
    const { client, create } = clientReturning(ok([]));
    const controller = new AbortController();
    await provider(client).findCandidates({
      query: "anything",
      maxCandidates: 12,
      signal: controller.signal,
    });
    expect(create.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });
});

describe("OpenAI provider response handling", () => {
  it("returns validated candidates and a cost estimate", async () => {
    const { client } = clientReturning(
      ok([
        { book: "1 Corinthians", chapter: 13, verse: 4 },
        { book: "Romans", chapter: 12, verse: 9 },
      ]),
    );
    const result = await provider(client).findCandidates({
      query: "love is patient",
      maxCandidates: 12,
    });
    expect(result.candidates).toEqual([
      { book: "1 Corinthians", chapter: 13, verse: 4 },
      { book: "Romans", chapter: 12, verse: 9 },
    ]);
    expect(result.usage).toMatchObject({ inputTokens: 299, outputTokens: 172, reasoningTokens: 0 });
    expect(result.usage?.estimatedCostUsd).toBeCloseTo((299 * 0.1 + 172 * 0.5) / 1_000_000, 10);
  });

  it("leaves the cost unknown for a model without a listed price", async () => {
    const { client } = clientReturning(ok([]));
    const result = await createOpenAiProvider({
      model: "other-model",
      effort: "none",
      client,
    }).findCandidates({
      query: "anything",
      maxCandidates: 12,
    });
    expect(result.usage?.estimatedCostUsd).toBeNull();
  });

  it("drops malformed items and keeps valid ones", async () => {
    const { client } = clientReturning(
      ok([
        null,
        "John 3:16",
        { book: "", chapter: 1, verse: 1 },
        { book: "John", chapter: 3.5, verse: 16 },
        { book: "John", chapter: 0, verse: 16 },
        { book: "John", chapter: 3, verse: 9999 },
        { book: "x".repeat(61), chapter: 1, verse: 1 },
        { book: "John", chapter: "3", verse: 16 },
        { book: " John ", chapter: 3, verse: 16 },
      ]),
    );
    const result = await provider(client).findCandidates({ query: "anything", maxCandidates: 12 });
    expect(result.candidates).toEqual([{ book: "John", chapter: 3, verse: 16 }]);
  });

  it("never returns more candidates than asked for", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      book: "Psalms",
      chapter: 23,
      verse: i + 1,
    }));
    const { client } = clientReturning(ok(many));
    const result = await provider(client).findCandidates({ query: "anything", maxCandidates: 5 });
    expect(result.candidates).toHaveLength(5);
  });

  it("treats an incomplete or failed response as unavailable", async () => {
    for (const status of ["incomplete", "failed", "cancelled"]) {
      const { client } = clientReturning(ok([{ book: "John", chapter: 3, verse: 16 }], { status }));
      await expect(
        provider(client).findCandidates({ query: "x y", maxCandidates: 12 }),
      ).rejects.toMatchObject({
        kind: "unavailable",
      });
    }
  });

  it("reports a refusal", async () => {
    const { client } = clientReturning({
      status: "completed",
      output_text: "",
      output: [{ content: [{ type: "refusal" }] }],
    });
    await expect(
      provider(client).findCandidates({ query: "x y", maxCandidates: 12 }),
    ).rejects.toMatchObject({
      kind: "refused",
    });
  });

  it("rejects output that is not the expected JSON", async () => {
    for (const output_text of [
      "",
      "   ",
      "not json",
      "{}",
      '{"references":"nope"}',
      "[]",
      "null",
      undefined,
      42,
    ]) {
      const { client } = clientReturning({ status: "completed", output_text });
      await expect(
        provider(client).findCandidates({ query: "x y", maxCandidates: 12 }),
      ).rejects.toMatchObject({
        kind: "invalid_output",
      });
    }
  });
});

describe("OpenAI provider error handling", () => {
  function failing(error: unknown) {
    const client: OpenAiClientLike = {
      responses: {
        create: vi.fn(async () => {
          throw error;
        }),
      },
    };
    return provider(client).findCandidates({ query: "x y", maxCandidates: 12 });
  }

  it("maps credential and request problems to not_configured", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      await expect(failing(Object.assign(new Error("bad"), { status }))).rejects.toMatchObject({
        kind: "not_configured",
        status,
      });
    }
  });

  it("maps rate limit, spend limit, server errors and timeouts to unavailable", async () => {
    for (const status of [429, 500, 502, 503]) {
      await expect(failing(Object.assign(new Error("later"), { status }))).rejects.toMatchObject({
        kind: "unavailable",
        status,
      });
    }
    await expect(
      failing(
        Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }),
      ),
    ).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(failing(new TypeError("fetch failed"))).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(failing("a string was thrown")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("never carries the provider's message, so a key echoed in an error cannot leak", async () => {
    const error = Object.assign(new Error(`Incorrect API key provided: ${SECRET}`), {
      status: 401,
    });
    const thrown = await failing(error).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(AiProviderError);
    expect(JSON.stringify(thrown)).not.toContain(SECRET);
    expect(String((thrown as Error).message)).not.toContain(SECRET);
    expect(String((thrown as Error).stack)).not.toContain(SECRET);
  });

  it("makes exactly one attempt even when the call fails (no retries)", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("busy"), { status: 429 });
    });
    const client: OpenAiClientLike = { responses: { create } };
    await expect(
      provider(client).findCandidates({ query: "x y", maxCandidates: 12 }),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("mapProviderError", () => {
  it("passes an AiProviderError through unchanged", () => {
    const error = new AiProviderError("refused");
    expect(mapProviderError(error)).toBe(error);
  });
});
