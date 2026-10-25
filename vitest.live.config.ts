import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// MANUAL live tests only (`npm run live:smoke`, `npm run live:eval`). These make real, paid
// OpenAI requests when - and only when - their approval variables are set; see
// src/lib/bible/ai/live/*.live.ts. `npm test` uses vitest.config.ts and never loads these files.
// Only OPENAI_API_KEY is taken from .env.local; nothing else is passed through.
const env = loadEnv("development", process.cwd(), "");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.live.ts"],
    env: { OPENAI_API_KEY: env["OPENAI_API_KEY"] ?? "" },
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
