// Decides whether a build ships the offline service worker (and registers it).
//   Preview builds (VERCEL_ENV=preview) and local builds with OFFLINE_SW=1 -> on
//   Production builds -> follow OFFLINE_IN_PRODUCTION below (owner enabled it; set it back to
//   false to ship Production without the worker; the next deployment then removes /sw.js and
//   registered workers clean themselves up through the ?sw=off / unregister path).
export const OFFLINE_IN_PRODUCTION = true;

export function offlineSwBuild(env = process.env) {
  if (env["OFFLINE_SW"] === "1") return true;
  if (env["OFFLINE_SW"] === "0") return false;
  if (env["VERCEL_ENV"] === "production") return OFFLINE_IN_PRODUCTION;
  return env["VERCEL_ENV"] === "preview";
}
