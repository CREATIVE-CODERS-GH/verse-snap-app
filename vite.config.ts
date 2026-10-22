// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
//
// Offline support: scripts/sw/build-sw.mjs writes /sw.js after the build; scripts/sw/flag.mjs decides
// per build whether it ships (Preview and Production, per OFFLINE_IN_PRODUCTION); see src/lib/pwa-register.ts.
// The installable web app manifest and icons are static files in public/.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { offlineSwBuild } from "./scripts/sw/flag.mjs";

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_OFFLINE_SW": JSON.stringify(offlineSwBuild() ? "true" : "false"),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
