import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import {
  discoverRequestSchema,
  type DiscoverData,
  type DiscoverOp,
  type DiscoverResult,
} from "./youversion-discover-protocol";

/**
 * Runs one Discover operation (trending, suggestions, search, passage text, image records).
 *
 * This file is bundled for the browser, so it holds only the server-function shell. The API key and the
 * HTTP calls live in ./youversion-discover.server.ts, loaded with a dynamic import inside the handler.
 * It is a POST so the service worker (which only touches GET) never caches search results or passage text.
 */
export const discoverSearch = createServerFn({ method: "POST" })
  .validator((input: unknown) => discoverRequestSchema.parse(input))
  .handler(async ({ data }): Promise<DiscoverResult<DiscoverData[DiscoverOp]>> => {
    const { runDiscover } = await import("./youversion-discover.server");
    const request = getRequest();
    return runDiscover(data, {
      // The TCP peer address from the runtime: never taken from a header (see ai/client-ip.server.ts).
      client: { headers: request.headers, socketIp: getRequestIP() },
    });
  });
