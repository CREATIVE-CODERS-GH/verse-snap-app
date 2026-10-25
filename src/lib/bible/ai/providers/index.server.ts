import type { AiSearchConfig } from "../config.server";
import type { ReferenceProvider } from "../types";
import { createOpenAiClient, createOpenAiProvider } from "./openai.server";

type Env = Record<string, string | undefined>;

/**
 * Chooses the reference provider named by AI_PROVIDER. Returns null when the provider is unknown,
 * disabled, or missing its credentials, which the search service reports as "not configured".
 * Adding a provider = one adapter file implementing ReferenceProvider plus one case here.
 * There is deliberately no fallback chain: a second, pricier model must never be tried automatically.
 */
export function createProvider(
  config: AiSearchConfig,
  env: Env = process.env,
): ReferenceProvider | null {
  switch (config.provider) {
    case "openai": {
      const apiKey = env["OPENAI_API_KEY"]?.trim();
      if (!apiKey) return null;
      return createOpenAiProvider({
        model: config.model,
        effort: config.effort,
        client: createOpenAiClient(apiKey),
      });
    }
    default:
      return null;
  }
}
