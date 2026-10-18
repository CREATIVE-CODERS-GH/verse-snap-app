import { BibleServiceError, type Translation } from "./types";

/** Complete English editions with public-domain text in the AO Lab catalogue. */
export const BIBLE_TRANSLATIONS: (Translation & { apiId: string })[] = [
  { code: "KJAV", apiId: "eng_kjv", name: "King James (Authorized) Version", language: "English" },
  { code: "BSB", apiId: "BSB", name: "Berean Standard Bible", language: "English" },
  { code: "WEB", apiId: "ENGWEBP", name: "World English Bible", language: "English" },
  { code: "ASV", apiId: "eng_asv", name: "American Standard Version (1901)", language: "English" },
  { code: "BBE", apiId: "eng_bbe", name: "Bible in Basic English", language: "English" },
];

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
    return value;
  }
}
