/**
 * Lightweight, anonymous product analytics.
 *
 * Only counts and small non-identifying metadata are recorded. Raw search text,
 * microphone audio, camera frames and account details are never sent.
 */
export type AnalyticsEvent =
  | "app_open"
  | "onboarding_completed"
  | "voice_search_started"
  | "voice_search_success"
  | "voice_search_failed"
  | "camera_opened"
  | "camera_ocr_success"
  | "camera_ocr_failed"
  | "manual_search"
  | "semantic_search"
  | "verse_opened"
  | "verse_saved"
  | "verse_shared"
  | "verse_copied"
  | "verse_listened"
  | "history_opened";

type Metadata = Record<string, string | number | boolean>;

export function trackEvent(event: AnalyticsEvent, metadata?: Metadata): void {
  if (typeof window === "undefined") return;
  try {
    window.__lovableEvents?.track?.(event, metadata);
  } catch {
    // Analytics must never interrupt the product.
  }
}
