import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import {
  youVersionChapterRequestSchema,
  type YouVersionChapterResult,
} from "./youversion-protocol";

/**
 * Loads one chapter of a licensed (YouVersion) edition.
 *
 * This file is bundled for the browser, so it holds only the server-function shell. The API key and
 * the HTTP call live in ./youversion.server.ts, loaded with a dynamic import inside the handler.
 * It is a POST so the service worker (which only touches GET) never caches licensed text.
 */
export const getYouVersionChapter = createServerFn({ method: "POST" })
  .validator((input: unknown) => youVersionChapterRequestSchema.parse(input))
  .handler(async ({ data }): Promise<YouVersionChapterResult> => {
    const { getChapterFromYouVersion } = await import("./youversion.server");
    const request = getRequest();
    return getChapterFromYouVersion(data, {
      // The TCP peer address from the runtime: never taken from a header (see ai/client-ip.server.ts).
      client: { headers: request.headers, socketIp: getRequestIP() },
    });
  });
