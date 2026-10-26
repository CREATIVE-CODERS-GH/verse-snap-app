// Native Vite configuration for TanStack Start + Nitro. Plugin order matters: Tailwind, tsconfig paths,
// TanStack Start, Nitro (build only), then React.
//
// Offline support: scripts/sw/build-sw.mjs writes /sw.js after the build; scripts/sw/flag.mjs decides
// per build whether it ships (Preview and Production, per OFFLINE_IN_PRODUCTION); see src/lib/pwa-register.ts.
// The installable web app manifest and icons are static files in public/.
//
// Nitro picks its target from the environment (VERCEL=1 on Vercel, or NITRO_PRESET); with neither set
// it builds a plain Node server, which is what the local offline e2e uses.
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { offlineSwBuild } from "./scripts/sw/flag.mjs";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Client code may not import server-only modules.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
    }),
    ...(command === "build" ? [nitro()] : []),
    react(),
  ],
  define: {
    "import.meta.env.VITE_OFFLINE_SW": JSON.stringify(offlineSwBuild() ? "true" : "false"),
  },
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  // Port 8080 is on the Supabase and Google OAuth redirect allow-lists.
  server: { host: "::", port: 8080 },
}));
