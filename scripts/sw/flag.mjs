// Decides whether a build ships the offline service worker (and registers it).
//   Preview builds (VERCEL_ENV=preview) and local builds with OFFLINE_SW=1 -> on
//   Production builds -> off until the owner accepts the Preview and sets
//   OFFLINE_IN_PRODUCTION to true below.
export const OFFLINE_IN_PRODUCTION = false;

export function offlineSwBuild(env = process.env) {
  if (env["OFFLINE_SW"] === "1") return true;
  if (env["OFFLINE_SW"] === "0") return false;
  if (env["VERCEL_ENV"] === "production") return OFFLINE_IN_PRODUCTION;
  return env["VERCEL_ENV"] === "preview";
}
