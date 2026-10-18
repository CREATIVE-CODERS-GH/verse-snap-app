// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      // Offline support: generated service worker at /sw.js. Registration is
      // handled solely by src/lib/pwa-register.ts, which never registers in
      // dev or Lovable preview contexts.
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        devOptions: { enabled: false },
        filename: "sw.js",
        // The app already ships public/manifest.webmanifest; don't emit another.
        manifest: false,
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
          navigateFallback: null,
          runtimeCaching: [
            {
              // App shell / pages: always try the network first so deploys
              // show up immediately; fall back to cache when offline.
              // OAuth callbacks must never be served from cache.
              urlPattern: ({ request, url }: { request: Request; url: URL }) =>
                request.mode === "navigate" &&
                url.origin === self.location.origin &&
                !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "vs-pages",
                networkTimeoutSeconds: 8,
                expiration: { maxEntries: 32 },
              },
            },
            {
              // Scripture text from the Bible API: immutable per edition, so a
              // long-lived cache makes previously read chapters work offline.
              urlPattern: ({ url }: { url: URL }) => url.origin === "https://bible.helloao.org",
              handler: "NetworkFirst",
              options: {
                cacheName: "vs-bible-api",
                networkTimeoutSeconds: 10,
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
