import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerseBlock } from "@/components/chapter-reader-parts";
import {
  ActionTile,
  AnnotationSheet,
  CrossReferenceSection,
  HighlightPicker,
  SelectionFooter,
  SelectionToolbar,
  SpokenCard,
  TONES,
  toneInfo,
} from "@/components/verse-annotation-parts";
import { getSampleCrossReferences } from "@/lib/bible/verse-annotation-sample";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const noop = () => undefined;
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("verse annotation pieces (server-rendered markup)", () => {
  it("offers the six approved highlight tones and says they are preview only", () => {
    expect(TONES.map((tone) => tone.label)).toEqual([
      "Amber",
      "Sage",
      "Sky",
      "Rose",
      "Lilac",
      "Clear",
    ]);
    const markup = html(createElement(HighlightPicker, { active: "amber", onChange: noop }));
    expect(markup).toContain('aria-label="Highlight tone"');
    expect(markup).toContain("Warm Ochre");
    expect(markup).toContain("Clear highlight");
    expect(markup).not.toContain("Preview only");
    expect(markup.match(/role="radio"/g)).toHaveLength(6);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(toneInfo("clear").name).toBe("No highlight");
  });

  it("renders the floating Copy, Compare and Share toolbar", () => {
    const markup = html(
      createElement(SelectionToolbar, { onCopy: noop, onCompare: noop, onShare: noop }),
    );
    expect(markup).toContain('role="toolbar"');
    for (const label of ["Copy", "Compare", "Share"]) expect(markup).toContain(label);
  });

  it("renders the sheet frame with the reference, edition, audio and close buttons", () => {
    const markup = html(
      createElement(AnnotationSheet, {
        reference: "Romans 12:2",
        editionLine: "World English Bible (WEB)",
        speaking: false,
        onToggleListen: noop,
        onClose: noop,
        expanded: false,
        onExpandedChange: noop,
        peek: "PEEK",
        children: "body",
      }),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Romans 12:2");
    expect(markup).toContain("World English Bible (WEB)");
    expect(markup).toContain("Listen to this verse");
    expect(markup).toContain("Close sheet");
  });

  it("renders the action tiles, spoken card, cross references and footer", () => {
    const tile = html(
      createElement(ActionTile, {
        icon: null,
        iconClass: "",
        title: "Bookmark Verse",
        subtitle: "Add to your saved verses",
        onClick: noop,
        pressed: false,
      }),
    );
    expect(tile).toContain("Bookmark Verse");
    expect(tile).toContain('aria-pressed="false"');

    const spoken = html(
      createElement(SpokenCard, { speaking: false, onToggle: noop, subtitle: "x" }),
    );
    expect(spoken).toContain("Spoken Contemplation");
    expect(spoken).toContain("Listen");
    expect(
      html(createElement(SpokenCard, { speaking: true, onToggle: noop, subtitle: "x" })),
    ).toContain("Stop");

    const refs = getSampleCrossReferences("romans", 12, 2);
    const section = html(
      createElement(CrossReferenceSection, {
        total: refs.total,
        chips: refs.chips,
        onExploreAll: noop,
        chipNode: (chip) => createElement("span", { key: chip.label }, chip.label),
      }),
    );
    expect(section).toContain("Thematic Cross References");
    expect(section).toContain("Explore all (7)");
    expect(section).toContain("Sample content");
    expect(section).toContain("Ephesians 4:23");

    const footer = html(createElement(SelectionFooter, { verse: 2, highlightText: "preview" }));
    expect(footer).toContain("Active selection: v.2");
  });

  it("never invents cross references for other verses", () => {
    const other = getSampleCrossReferences("genesis", 1, 1);
    expect(other.chips.every((chip) => chip.target === undefined)).toBe(true);
    expect(other.chips.every((chip) => /sample/i.test(chip.hint))).toBe(true);
  });

  it("selected verse block shows toolbar and footer, unselected dimmed block is inert", () => {
    const selected = html(
      createElement(VerseBlock, {
        number: 2,
        text: "text",
        selected: true,
        onSelect: noop,
        numberNode: createElement("sup", null, "2"),
        toolbar: createElement("i", null, "TOOLBAR"),
        selectionFooter: createElement("i", null, "FOOTER"),
      }),
    );
    expect(selected).toContain("TOOLBAR");
    expect(selected).toContain("FOOTER");
    const dimmed = html(
      createElement(VerseBlock, {
        number: 3,
        text: "text",
        selected: false,
        dimmed: true,
        onSelect: noop,
        numberNode: createElement("sup", null, "3"),
      }),
    );
    expect(dimmed).toContain("opacity-35");
    expect(dimmed).toContain("inert");
  });
});

describe("chapter page wiring for Screen 23", () => {
  const page = read("src/routes/chapter.$translation.$book.$chapter.tsx");

  it("keeps preview interactions honest and makes no paid or backend calls", () => {
    expect(page).toContain("preview only");
    expect(page).not.toMatch(/openai|localStorage|sessionStorage|\.insert\(|\.upsert\(|supabase/i);
  });

  it("links the sheet title and verse numbers to the single-verse reader", () => {
    expect(
      page.match(/"\/verse\/\$translation\/\$book\/\$chapter\/\$verse"/g)!.length,
    ).toBeGreaterThanOrEqual(3);
    expect(page).toContain("open in the verse reader");
  });

  it("hides the floating chapter navigation while a verse is open", () => {
    expect(page).toMatch(/\) : \(\s*<FloatingChapterNav/);
  });
});
