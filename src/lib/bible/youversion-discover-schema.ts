import { YOUVERSION_TRANSLATIONS_ENABLED } from "./youversion-schema";

/**
 * Switch for Discover, the YouVersion-powered search mode. It needs the YouVersion editions to be on
 * (`VITE_YOUVERSION_TRANSLATIONS=true`) and its own flag, `VITE_YOUVERSION_DISCOVER=true`, set when the app
 * starts. Off by default, so enabling NIV and AMP for reading never turns Discover on by itself, and the
 * Search screen is unchanged while it is off.
 */
export const YOUVERSION_DISCOVER_ENABLED =
  YOUVERSION_TRANSLATIONS_ENABLED && import.meta.env["VITE_YOUVERSION_DISCOVER"] === "true";
