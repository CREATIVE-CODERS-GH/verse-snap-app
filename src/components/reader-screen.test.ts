import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ReaderAction,
  VerseFocus,
  VerseNavCardContent,
  NAV_CARD_DISABLED,
} from "@/components/reader-parts";
import { TranslationOptions } from "@/components/translation-sheet";
import { BIBLE_TRANSLATIONS } from "@/lib/bible/translations";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const PAGE = "src/routes/verse.$translation.$book.$chapter.$verse.tsx";

describe("single-verse reading screen (Stitch 06)", () => {
  const page = read(PAGE);

  it("hides the bottom navigation and uses the Stitch frame", () => {
    expect(page).toContain('variant="stitch"');
    expect(page).toContain("hideNav");
  });

  it("orders the actions Save, Share, Copy, Listen", () => {
    const order = [
      "toggleSave.mutate()",
      "onClick={handleShare}",
      "onClick={handleCopy}",
      "onClick={handleListen}",
    ];
    const positions = order.map((needle) => page.indexOf(needle));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps every existing behaviour: queries, library, history, analytics, share and listen", () => {
    for (const needle of [
      "bibleService.getVerse(ref, params.translation)",
      "bibleService.getNeighbour(ref, -1, params.translation)",
      "bibleService.getNeighbour(ref, 1, params.translation)",
      "bibleService.listTranslations()",
      "library.isSaved(",
      "library.unsave(",
      "library.save(verse, user?.id)",
      ".recordView(verse, user?.id)",
      'trackEvent("verse_opened")',
      'trackEvent("verse_saved")',
      'trackEvent("verse_copied")',
      // Listening goes through the shared narration engine (src/lib/use-speak.ts).
      "useSpeak(",
      "speech.toggle(",
      // Share opens the Share Options sheet (Stitch 13), which handles text and image sharing.
      "<ShareSheet",
      'toast("Copied")',
      "verseQuery.refetch()",
      "You’re offline, and this verse isn’t saved on this device yet.",
    ]) {
      expect(page, needle).toContain(needle);
    }
  });

  it("links to the chapter, and keeps the translation in the URL only", () => {
    expect(page).toContain('"/chapter/$translation/$book/$chapter"');
    expect(page).toContain("params: { ...params, translation: code }");
    // No new default-preference behaviour.
    expect(page).not.toMatch(/bsetTranslationb|useServerFn|supabase/);
  });

  it("offers only catalogue translations in the sheet", () => {
    expect(page).toContain("translations ?? BIBLE_TRANSLATIONS");
    const markup = renderToStaticMarkup(
      createElement(TranslationOptions, {
        options: BIBLE_TRANSLATIONS,
        value: "KJAV",
        onChange: () => undefined,
      }),
    );
    for (const edition of BIBLE_TRANSLATIONS) expect(markup).toContain(edition.name);
    expect(markup.match(/type="radio"/g)).toHaveLength(BIBLE_TRANSLATIONS.length);
    expect(markup).not.toMatch(/NIV|ESV|NASB|NLT/);
    expect(markup).toContain('checked=""');
  });
});

describe("reader pieces (server-rendered markup)", () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element);

  it("renders the verse in the Stitch type with a non-selectable number", () => {
    const markup = html(createElement(VerseFocus, { number: 2, text: "And be not conformed." }));
    expect(markup).toContain("scripture-focus");
    expect(markup).toContain("select-none");
    expect(markup).toContain("And be not conformed.");
  });

  it("marks toggle actions with aria-pressed and leaves others plain", () => {
    const icon = createElement("svg");
    const saved = html(
      createElement(ReaderAction, {
        label: "Saved",
        icon,
        onClick: () => undefined,
        pressed: true,
      }),
    );
    const plain = html(
      createElement(ReaderAction, { label: "Copy", icon, onClick: () => undefined }),
    );
    expect(saved).toContain('aria-pressed="true"');
    expect(plain).not.toContain("aria-pressed");
  });

  it("labels the navigation cards", () => {
    const previous = html(
      createElement(VerseNavCardContent, { direction: "previous", reference: "Romans 12:1" }),
    );
    const next = html(
      createElement(VerseNavCardContent, { direction: "next", reference: "Romans 12:3" }),
    );
    expect(previous).toContain("Romans 12:1");
    expect(previous).toContain("Previous");
    expect(next).toContain("Next");
    expect(NAV_CARD_DISABLED).toContain("opacity");
  });
});

describe("text size and fonts", () => {
  const css = read("src/styles.css");

  it("defaults the verse to 28px and scales it with the existing preference", () => {
    expect(css).toContain("--verse-focus-size: 1.75rem;");
    expect(css).toMatch(/\[data-text-size="small"\][\s\S]*?--verse-focus-size: 1\.5rem/);
    expect(css).toMatch(/\[data-text-size="large"\][\s\S]*?--verse-focus-size: 2rem/);
    expect(css).toMatch(/\[data-text-size="xlarge"\][\s\S]*?--verse-focus-size: 2\.25rem/);
    expect(css).toContain("@utility scripture-focus");
  });

  it("loads Playfair Display regular weight", () => {
    expect(read("src/routes/__root.tsx")).toContain(
      "Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600",
    );
  });
});
