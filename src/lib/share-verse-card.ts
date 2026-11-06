import { trackEvent } from "./analytics";
import type { Verse } from "./bible/types";
import { canShareExternally, publisherNoticeText } from "./bible/translations";
import { copyText } from "./copy-text";
import { createVerseImageBlob, verseImageFileName } from "./share-verse-image";

/** Shown instead of sharing when the publisher's terms do not yet allow it. */
export const externalShareMessage = (translation: string) =>
  `Sharing ${translation} outside Verse Snap isn’t available yet. You can copy the verse instead.`;

/** The text copied for one verse. Licensed editions carry their publisher notice (and link) with them. */
export function verseShareText(verse: Verse): string {
  const base = `${verse.reference}\n${verse.translation}\n\n${verse.text}`;
  const notice = publisherNoticeText(verse.translation);
  return notice ? `${base}\n\n${notice}` : base;
}

/**
 * Shares one verse as an image card, falling back to text sharing and then the clipboard. This is
 * the same behaviour as the Share button on the single-verse page (until Screen 13 redesigns it);
 * `notify` receives the short messages that page shows as toasts.
 */
export async function shareVerseCard(
  verse: Verse,
  notify: (message: string) => void,
): Promise<void> {
  // A licensed edition that may not leave the app (NIV) is neither exported nor shared.
  if (!canShareExternally(verse.translation)) {
    notify(externalShareMessage(verse.translation));
    return;
  }
  const shareText = verseShareText(verse);
  trackEvent("verse_shared");
  try {
    const blob = await createVerseImageBlob(verse);
    const file = new File([blob], verseImageFileName(verse), { type: "image/png" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: verse.reference, text: shareText });
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Image downloaded");
    return;
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    // Fall through to text sharing below.
  }
  await shareVerseText(verse, notify, false);
}

/** Shares a verse as plain text: the system share sheet where available, otherwise the clipboard. */
export async function shareVerseText(
  verse: Verse,
  notify: (message: string) => void,
  track = true,
): Promise<void> {
  if (!canShareExternally(verse.translation)) {
    notify(externalShareMessage(verse.translation));
    return;
  }
  const shareText = verseShareText(verse);
  if (track) trackEvent("verse_shared");
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: verse.reference, text: shareText });
    } catch (error) {
      if ((error as Error).name !== "AbortError") notify("Could not share this verse");
    }
    return;
  }
  try {
    await copyText(shareText);
    notify("Copied to clipboard");
  } catch {
    notify("Sharing isn't available on this device");
  }
}
