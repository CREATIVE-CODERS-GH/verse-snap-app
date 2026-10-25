import OpenAI from "openai";
import { MAX_CANDIDATES, SCHEMA, SYSTEM_PROMPT } from "../prompt";
import {
  AiProviderError,
  type FindCandidatesInput,
  type FindCandidatesOutput,
  type ProviderUsage,
  type ReferenceCandidate,
  type ReferenceProvider,
} from "../types";
import type { ReasoningEffort } from "../config.server";

/**
 * OpenAI adapter (Responses API, strict structured JSON output).
 *
 * Cost safety: one request per search, no automatic retries (maxRetries: 0), no fallback model,
 * a hard output cap, and a short timeout. Provider error text is never kept or returned.
 */

/** Longest answer we will pay for, including reasoning tokens. */
export const MAX_OUTPUT_TOKENS = 2000;
export const REQUEST_TIMEOUT_MS = 15_000;

/** List prices in USD per million tokens, used only for the usage estimate in logs and evaluations. */
export const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

/** The slice of the OpenAI client this adapter uses (also what tests substitute). */
export interface OpenAiClientLike {
  responses: {
    create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  };
}

export interface OpenAiProviderOptions {
  model: string;
  effort: ReasoningEffort;
  client: OpenAiClientLike;
}

/** Builds the real SDK client. The key is read by the caller from the server environment only. */
export function createOpenAiClient(apiKey: string): OpenAiClientLike {
  return new OpenAI({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0, // every retry would be another paid request
  }) as unknown as OpenAiClientLike;
}

interface ResponseLike {
  status?: string | null;
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string }> }> | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  } | null;
}

export function createOpenAiProvider(options: OpenAiProviderOptions): ReferenceProvider {
  return {
    id: "openai",
    async findCandidates(input: FindCandidatesInput): Promise<FindCandidatesOutput> {
      let response: ResponseLike;
      try {
        response = (await options.client.responses.create(
          {
            model: options.model,
            instructions: SYSTEM_PROMPT,
            input: input.query,
            reasoning: { effort: options.effort },
            max_output_tokens: MAX_OUTPUT_TOKENS,
            text: {
              format: {
                type: "json_schema",
                name: "bible_references",
                strict: true,
                schema: SCHEMA,
              },
            },
          },
          input.signal ? { signal: input.signal } : undefined,
        )) as ResponseLike;
      } catch (error) {
        throw mapProviderError(error);
      }

      const usage = readUsage(response, options.model);

      if (response.status === "incomplete") throw new AiProviderError("unavailable");
      if (response.status === "failed" || response.status === "cancelled") {
        throw new AiProviderError("unavailable");
      }
      const refused = (response.output ?? []).some((item) =>
        (item.content ?? []).some((part) => part.type === "refusal"),
      );
      if (refused) throw new AiProviderError("refused");

      const candidates = parseCandidates(response.output_text, input.maxCandidates);
      return usage ? { candidates, usage } : { candidates };
    },
  };
}

function readUsage(response: ResponseLike, model: string): ProviderUsage | undefined {
  const usage = response.usage;
  if (!usage) return undefined;
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens ?? 0);
  const price = PRICES_PER_MILLION[model];
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    estimatedCostUsd: price
      ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000
      : null,
  };
}

function parseCandidates(outputText: unknown, maxCandidates: number): ReferenceCandidate[] {
  if (typeof outputText !== "string" || !outputText.trim()) {
    throw new AiProviderError("invalid_output");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new AiProviderError("invalid_output");
  }
  const references = (parsed as { references?: unknown } | null)?.references;
  if (!Array.isArray(references)) throw new AiProviderError("invalid_output");

  const candidates: ReferenceCandidate[] = [];
  for (const item of references) {
    if (!item || typeof item !== "object") continue;
    const { book, chapter, verse } = item as Record<string, unknown>;
    if (typeof book !== "string" || !book.trim() || book.length > 60) continue;
    if (!Number.isInteger(chapter) || !Number.isInteger(verse)) continue;
    const c = chapter as number;
    const v = verse as number;
    if (c < 1 || c > 200 || v < 1 || v > 200) continue;
    candidates.push({ book: book.trim(), chapter: c, verse: v });
    if (candidates.length >= Math.min(maxCandidates, MAX_CANDIDATES)) break;
  }
  return candidates;
}

/** Maps any SDK failure to a coarse, safe error. Nothing from the provider's message is retained. */
export function mapProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const status =
    typeof (error as { status?: unknown } | null)?.status === "number"
      ? ((error as { status: number }).status as number)
      : undefined;
  if (status === 401 || status === 403 || status === 404 || status === 400 || status === 422) {
    return new AiProviderError("not_configured", status);
  }
  return new AiProviderError("unavailable", status);
}
