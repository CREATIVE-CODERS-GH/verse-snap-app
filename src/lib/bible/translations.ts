import { BibleServiceError, type Translation, type TranslationAttribution } from "./types";
import { YOUVERSION_TRANSLATIONS_ENABLED } from "./youversion-schema";

/** Complete English editions with public-domain text in the AO Lab catalogue. */
export const BIBLE_TRANSLATIONS: (Translation & { apiId: string })[] = [
  { code: "KJAV", apiId: "eng_kjv", name: "King James (Authorized) Version", language: "English" },
  { code: "BSB", apiId: "BSB", name: "Berean Standard Bible", language: "English" },
  { code: "WEB", apiId: "ENGWEBP", name: "World English Bible", language: "English" },
  { code: "ASV", apiId: "eng_asv", name: "American Standard Version (1901)", language: "English" },
  { code: "BBE", apiId: "eng_bbe", name: "Bible in Basic English", language: "English" },
  { code: "FBV", apiId: "eng_fbv", name: "Free Bible Version", language: "English" },
];

/**
 * Licensed editions served by the YouVersion Platform. They are NOT in BIBLE_TRANSLATIONS on purpose:
 * that list drives free search, offline downloads and AI search, and none of those may use licensed
 * text. They are listed for reading only, and only while YOUVERSION_TRANSLATIONS_ENABLED is on.
 * Notices are the publishers' required wording (Biblica and Lockman agreements, reviewed 2026-11).
 */
export interface YouVersionEdition extends Translation {
  bibleId: number;
  attribution: TranslationAttribution;
  /**
   * Whether Verse Snap may export this edition's text as an image. NIV: no. The Biblica terms reviewed
   * exclude "the transfer or download of any media files of the CONTENT" and are still a template.
   * AMP: yes, with the full Lockman notice drawn on the image.
   */
  imageExport: boolean;
  /**
   * Whether Verse Snap may hand this edition's text to other apps (the system share sheet, Messages,
   * WhatsApp). NIV: no, until Biblica confirms how its notice and one-step link must travel with
   * shared text.
   */
  externalShare: boolean;
  /**
   * Whether the reader may copy this edition's text to the clipboard. NIV: no, until Biblica
   * clarifies whether in-app copying is covered by its agreement (a copy leaves the app).
   */
  copyText: boolean;
}

export const YOUVERSION_EDITIONS: YouVersionEdition[] = [
  {
    code: "NIV",
    bibleId: 111,
    name: "New International Version (2011)",
    language: "English",
    imageExport: false,
    externalShare: false,
    copyText: false,
    attribution: {
      notice:
        "The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.",
      linkLabel: "Biblica",
      linkUrl: "https://www.biblica.com/",
    },
  },
  {
    code: "AMP",
    bibleId: 1588,
    name: "Amplified Bible",
    language: "English",
    imageExport: true,
    externalShare: true,
    copyText: true,
    attribution: {
      notice:
        "Amplified® Bible Copyright © 2015 by The Lockman Foundation, La Habra, Calif. Used by permission. All rights reserved. For Permission to Quote Information visit www.Lockman.org",
      linkLabel: "Lockman.org",
      linkUrl: "https://www.lockman.org/",
    },
  },
];

/** The licensed edition for a code, or undefined if it is not one or the feature is switched off. */
export function getYouVersionEdition(value: string): YouVersionEdition | undefined {
  if (!YOUVERSION_TRANSLATIONS_ENABLED) return undefined;
  return YOUVERSION_EDITIONS.find((item) => item.code === value);
}

/** False only for a licensed edition whose publisher terms do not allow image export (NIV). */
export function canExportImage(value: string): boolean {
  return YOUVERSION_EDITIONS.find((item) => item.code === value)?.imageExport ?? true;
}

/** False only for a licensed edition that may not be handed to other apps (NIV). */
export function canShareExternally(value: string): boolean {
  return YOUVERSION_EDITIONS.find((item) => item.code === value)?.externalShare ?? true;
}

/** False only for a licensed edition whose text may not be copied to the clipboard (NIV). */
export function canCopyText(value: string): boolean {
  return YOUVERSION_EDITIONS.find((item) => item.code === value)?.copyText ?? true;
}

/** Licensed editions stay out of Study Together until YouVersion and the publishers answer for group use. */
export function canUseInStudyTogether(value: string): boolean {
  return !isRestrictedTranslation(value);
}

/** True for any licensed edition, whether or not the feature is on. Its text must never be stored. */
export function isRestrictedTranslation(value: string): boolean {
  return YOUVERSION_EDITIONS.some((item) => item.code === value);
}

/** Every edition the Bible Reader may list: the HelloAO six, plus the licensed ones when enabled. */
export function readerTranslations(): Translation[] {
  const base: Translation[] = BIBLE_TRANSLATIONS.map(({ code, name, language }) => ({
    code,
    name,
    language,
  }));
  if (!YOUVERSION_TRANSLATIONS_ENABLED) return base;
  return [
    ...base,
    ...YOUVERSION_EDITIONS.map(({ code, name, language, attribution }) => ({
      code,
      name,
      language,
      attribution,
    })),
  ];
}

/**
 * The notice as plain text for copied text: the publisher's wording, plus its link unless the wording
 * already names the site (Lockman's does).
 */
export function publisherNoticeText(value: string): string | undefined {
  const attribution = translationAttribution(value);
  if (!attribution) return undefined;
  const host = new URL(attribution.linkUrl).host.replace(/^www\./, "").toLowerCase();
  return attribution.notice.toLowerCase().includes(host)
    ? attribution.notice
    : `${attribution.notice} ${attribution.linkUrl}`;
}

/** Adds the publisher notice of each licensed edition among `codes` (once each) to copied text. */
export function appendPublisherNotices(text: string, codes: readonly string[]): string {
  const notices = [...new Set(codes.map((code) => publisherNoticeText(code)).filter(Boolean))];
  return notices.length > 0 ? `${text}\n\n${notices.join("\n")}` : text;
}

/** The publisher notice for a translation code, if it is a licensed edition. */
export function translationAttribution(value: string): TranslationAttribution | undefined {
  return YOUVERSION_EDITIONS.find((item) => item.code === value)?.attribution;
}

export function resolveTranslation(value: string) {
  const normalized = value === "KJV" ? "KJAV" : value;
  const translation = BIBLE_TRANSLATIONS.find(
    (item) => item.code === normalized || item.apiId === normalized,
  );
  if (!translation)
    throw new BibleServiceError("translation", "That translation is not available.");
  return translation;
}

export function translationName(value: string): string {
  try {
    return resolveTranslation(value).name;
  } catch {
    return YOUVERSION_EDITIONS.find((item) => item.code === value)?.name ?? value;
  }
}
