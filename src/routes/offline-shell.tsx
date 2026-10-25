import { createFileRoute } from "@tanstack/react-router";

/*
 * The document the offline service worker keeps as the app's "shell" (see scripts/sw/). It is
 * rendered on the server without any page content (ssr: false), so when the worker serves it for
 * another address while offline there is no server-made page body for the browser to disagree with.
 * It is not linked from anywhere and is kept out of search results.
 */
export const Route = createFileRoute("/offline-shell")({
  ssr: false,
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: () => null,
});
