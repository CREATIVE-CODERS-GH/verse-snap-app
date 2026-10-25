import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import { freeSearchRequestSchema, type FreeSearchServerResult } from "./free-search-protocol";

/**
 * Free keyword and phrase search over the Bible index (no AI, no cost).
 *
 * This file is bundled for the browser, so it holds only the server-function shell. Everything that
 * touches the database, the service-role key or the rate limiter lives in ./free-search.server.ts and
 * is loaded with a dynamic import inside the handler (server only).
 *
 * It is a POST: the query travels in the request body, never in a URL. That is not by itself a
 * privacy measure, so the server also never stores, caches or logs the text (see free-search.server.ts).
 */
export const searchFreeBible = createServerFn({ method: "POST" })
  .validator((input: unknown) => freeSearchRequestSchema.parse(input))
  .handler(async ({ data }): Promise<FreeSearchServerResult> => {
    const { runFreeSearch } = await import("./free-search.server");
    const request = getRequest();
    return runFreeSearch(data, {
      headers: request.headers,
      authorization: request.headers.get("authorization"),
      // The TCP peer address from the runtime: never taken from a header.
      socketIp: getRequestIP(),
      signal: request.signal,
    });
  });
