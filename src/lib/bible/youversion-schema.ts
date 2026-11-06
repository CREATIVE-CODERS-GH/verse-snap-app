/**
 * Switch for the YouVersion-backed editions (NIV, AMP). OFF unless `VITE_YOUVERSION_TRANSLATIONS=true`
 * is set when the app starts, so nothing reaches users by default.
 *
 * Only this boolean is exposed to the browser (the VITE_ prefix). The API key, `YOUVERSION_APP_KEY`,
 * is read on the server only and is never part of a client bundle.
 *
 * Development only for now: do not set it in Preview or Production until the publisher conditions in
 * docs/audit/YOUVERSION_YV1.md are confirmed.
 */
export const YOUVERSION_TRANSLATIONS_ENABLED =
  import.meta.env["VITE_YOUVERSION_TRANSLATIONS"] === "true";
