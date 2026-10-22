import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EditorStatus,
  FormatToolbar,
  JournalHeader,
  OrganizationCard,
  PostureRow,
  ReferenceCard,
  TagsSection,
} from "@/components/reflection-parts";
import { getReflectionSuggestions } from "@/lib/bible/reflection-sample";
import {
  applyFormat,
  countWords,
  normaliseTag,
  plainNote,
  scriptureCitation,
  wordCountLabel,
} from "@/lib/reflection-format";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const noop = () => undefined;
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("reflection formatting", () => {
  it("counts words and ignores formatting markers", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Renewal of the mind")).toBe(4);
    expect(countWords("**Renewal** of _the_ mind\n• daily")).toBe(5);
    expect(wordCountLabel(1)).toBe("1 word");
    expect(wordCountLabel(34)).toBe("34 words");
  });

  it("wraps the selection in bold or italic markers, and unwraps it again", () => {
    const bold = applyFormat({ text: "be transformed", start: 3, end: 14 }, "bold");
    expect(bold).toEqual({ text: "be **transformed**", start: 5, end: 16 });
    expect(applyFormat(bold, "bold")).toEqual({ text: "be transformed", start: 3, end: 14 });
    expect(applyFormat({ text: "mind", start: 0, end: 4 }, "italic").text).toBe("_mind_");
    // With no selection the markers are inserted around the cursor.
    expect(applyFormat({ text: "", start: 0, end: 0 }, "bold")).toEqual({
      text: "****",
      start: 2,
      end: 2,
    });
  });

  it("toggles bullets on the selected lines", () => {
    const listed = applyFormat({ text: "one\ntwo", start: 0, end: 7 }, "bullet");
    expect(listed.text).toBe("• one\n• two");
    expect(applyFormat({ ...listed, start: 0, end: listed.text.length }, "bullet").text).toBe(
      "one\ntwo",
    );
  });

  it("inserts the scripture citation on its own line", () => {
    const citation = scriptureCitation(" Do not conform ", "Romans 12:2", "KJAV");
    expect(citation).toBe("“Do not conform” — Romans 12:2 (KJAV)");
    const next = applyFormat({ text: "My note", start: 7, end: 7 }, "quote", citation);
    expect(next.text).toBe(`My note\n${citation}\n`);
    expect(next.start).toBe(next.text.length);
  });

  it("normalises new tags", () => {
    expect(normaliseTag("faith")).toBe("#Faith");
    expect(normaliseTag("#spiritual growth ")).toBe("#SpiritualGrowth");
    expect(normaliseTag("  #  ")).toBeNull();
    expect(normaliseTag("a".repeat(40))!.length).toBe(25);
  });
});

describe("plain note text (previews and search)", () => {
  it("removes bold and italic markers but keeps the words and other underscores", () => {
    expect(plainNote("be **transformed** by the _renewing_ of your mind")).toBe(
      "be transformed by the renewing of your mind",
    );
    expect(plainNote("_Start_ here, then **stop**.")).toBe("Start here, then stop.");
    expect(plainNote("see snake_case_name and 2 ** 3")).toBe("see snake_case_name and 2  3");
    expect(plainNote("• a list item")).toBe("• a list item");
  });
});

describe("reflection suggestions (sample content)", () => {
  it("uses the design's Romans 12:2 copy only for that verse", () => {
    expect(getReflectionSuggestions("romans", 12, 2).theme).toBe("Transformation & Discernment");
    expect(getReflectionSuggestions("romans", 12, 2).tags).toContain("#MindRenewal");
    const other = getReflectionSuggestions("john", 3, 16);
    expect(other.theme).toBeNull();
    expect(other.tags).not.toContain("#MindRenewal");
  });

  it("suggests no notebooks: notebooks are the person's own", () => {
    expect(getReflectionSuggestions("romans", 12, 2)).not.toHaveProperty("notebookId");
  });
});

describe("reflection journal pieces (server-rendered markup)", () => {
  it("renders the header, reference card and editor status", () => {
    const header = html(createElement(JournalHeader, { onBack: noop, menu: null }));
    expect(header).toContain("Verse Reflection &amp; Note Journal");
    expect(header).toContain("Go back");
    const card = html(
      createElement(ReferenceCard, {
        referenceLabel: "Romans 12:2 (KJAV)",
        highlight: { name: "Warm Ochre", dot: "bg-ch-secondary" },
        verseText: "“Be transformed”",
        theme: "Theme: Transformation",
        contextLink: createElement("a", null, "View Context"),
      }),
    );
    for (const text of [
      "Romans 12:2 (KJAV)",
      "Highlight: Warm Ochre",
      "Be transformed",
      "View Context",
    ]) {
      expect(card).toContain(text);
    }
    const status = html(
      createElement(EditorStatus, {
        status: "Preview · not saved",
        editing: false,
        words: "0 words",
      }),
    );
    expect(status).toContain("Preview · not saved");
    expect(status).toContain("0 words");
  });

  it("renders the posture row, tags and organisation card", () => {
    expect(html(createElement(PostureRow, { label: null, onChange: noop }))).toContain("Choose");
    expect(html(createElement(PostureRow, { label: "Grateful", onChange: noop }))).toContain(
      "Change",
    );
    const tags = html(
      createElement(TagsSection, {
        tags: ["#Faith", "#Prayer"],
        selected: new Set(["#Faith"]),
        onToggle: noop,
        addControl: createElement("button", null, "Add Tag"),
      }),
    );
    expect(tags).toContain("Topics &amp; Tags");
    expect(tags).toContain("Selected (1)");
    expect(tags.match(/aria-pressed="true"/g)).toHaveLength(1);
    const org = html(
      createElement(OrganizationCard, {
        notebookName: "General Reflections",
        notebookNote: "Preview",
        onOpenNotebooks: noop,
        isPrivate: true,
        onTogglePrivate: noop,
      }),
    );
    expect(org).toContain("Notebook / Collection");
    expect(org).toContain("Keep Note Private");
    expect(org).toContain('role="switch"');
    expect(org).toContain('aria-checked="true"');
  });

  it("renders the formatting toolbar with dictation and Save Note", () => {
    const toolbar = html(
      createElement(FormatToolbar, {
        onFormat: noop,
        dictating: false,
        onDictate: noop,
        onSave: noop,
      }),
    );
    for (const label of [
      "Bold text",
      "Italic text",
      "Bullet list",
      "Insert Scripture citation",
      "Voice dictation",
      "Save Note",
    ]) {
      expect(toolbar).toContain(label);
    }
  });
});

describe("reflection journal page", () => {
  const page = read("src/routes/reflect.$translation.$book.$chapter.$verse.tsx");

  it("saves only through the journal module, never touching storage or the database itself", () => {
    expect(page).not.toMatch(/Auto-saved|localStorage|sessionStorage|supabase|\.insert\(/);
    expect(page).toContain("journal.saveReflection(verseKey, vars.draft, vars.base, vars.userId)");
    expect(page).toContain("journal.deleteReflection(vars.id, vars.userId)");
  });

  it("stays an honest preview where the journal can't be saved yet (signed in, not enabled)", () => {
    expect(page).toContain("const persisted = journal.persists(user?.id);");
    expect(page).toContain("Not saved — the journal isn’t connected yet");
    expect(page).toContain("Preview · notes aren’t saved yet");
  });

  it("keeps the person's text when a save fails or meets a newer copy", () => {
    expect(page).toContain("Couldn’t save — your reflection is still here");
    expect(page).toContain("This note changed on another device. Your text is still here");
  });

  it("reuses the verse query and the browser dictation hook", () => {
    expect(page).toContain(
      'queryKey: ["verse", params.translation, params.book, params.chapter, params.verse]',
    );
    expect(page).toContain("useDictation(insertDictation)");
    expect(page).toContain("isn’t supported in this browser");
  });
});
