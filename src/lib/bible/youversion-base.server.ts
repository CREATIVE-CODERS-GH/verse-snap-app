import { isOnVercel } from "./ai/client-ip.server";

export const YOUVERSION_API_BASE = "https://api.youversion.com";

/**
 * Where YouVersion calls go. Always https://api.youversion.com, with one test seam: while developing
 * locally, `YOUVERSION_API_BASE_URL` may point at a loopback mock (scripts/e2e/youversion-discover.mjs), so
 * browser tests can run without any live YouVersion traffic. The override is ignored on Vercel, in a
 * production build, and for any host that is not 127.0.0.1, localhost or ::1, so it cannot redirect the
 * app key anywhere real.
 */
export function resolveYouVersionBase(env: Record<string, string | undefined> = process.env): {
  base: string;
  /** The mock's origin when the override is active, else null. */
  mockOrigin: string | null;
} {
  const wanted = env["YOUVERSION_API_BASE_URL"]?.trim();
  if (!wanted || env["NODE_ENV"] === "production" || isOnVercel(env)) {
    return { base: YOUVERSION_API_BASE, mockOrigin: null };
  }
  try {
    const url = new URL(wanted);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol === "http:" && loopback) return { base: url.origin, mockOrigin: url.origin };
  } catch {
    /* not a URL: fall through to the real API */
  }
  return { base: YOUVERSION_API_BASE, mockOrigin: null };
}
