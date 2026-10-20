import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import { searchInputSchema } from "./ai/input";
import type { ScriptureSearchResponse, ScriptureSearchResult } from "./ai/types";

export type { ScriptureSearchResponse, ScriptureSearchResult };

/**
 * Finds real Bible verses matching a plain-language description.
 *
 * This file is bundled for the browser, so it holds only the server-function shell. Everything
 * that touches secrets, the AI provider or the quota database lives in ./ai/*.server.ts and is
 * loaded with a dynamic import inside the handler (server only).
 *
 * The model only proposes references; every verse shown is fetched from the configured Bible
 * source and dropped if it does not resolve. See ./ai/search-service.server.ts for the policy
 * (kill switch, query rules, quota before any paid call, fail-closed behaviour).
 */
export const searchScripture = createServerFn({ method: "POST" })
  .validator((input: unknown) => searchInputSchema.parse(input))
  .handler(async ({ data }): Promise<ScriptureSearchResponse> => {
    const { runAiSearch } = await import("./ai/search-service.server");
    const request = getRequest();
    return runAiSearch(
      { query: data.query, translation: data.translation },
      {
        headers: request.headers,
        authorization: request.headers.get("authorization"),
        // The TCP peer address from the runtime: never taken from a header.
        socketIp: getRequestIP(),
      },
    );
  });
