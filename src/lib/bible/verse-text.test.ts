import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { helloAoProvider } from "./helloao-provider";
import { assembleVerseText } from "./verse-text";

/** The rule the Reader used before: pieces joined with nothing between them. */
function legacy(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(legacy).join("");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if ("noteId" in item) return " ";
  if (typeof item["text"] === "string") return item["text"];
  if (Array.isArray(item["content"])) return legacy(item["content"]);
  return "";
}
const legacyText = (content: unknown) => legacy(content).replace(/\s+/g, " ").trim();
const poem = (text: string, line = 1) => ({ text, poem: line });

describe("assembleVerseText: adjacent words", () => {
  it("separates pieces that are different words", () => {
    expect(assembleVerseText(["Friends", poem("We will be glad")])).toBe("Friends We will be glad");
    expect(assembleVerseText([poem("firstborn of Egypt"), "His loving devotion"])).toBe(
      "firstborn of Egypt His loving devotion",
    );
  });

  it("separates poetry lines whether or not a line break sits between them", () => {
    const lines = [
      poem("I will observe thy statutes:"),
      { lineBreak: true },
      poem("Oh forsake me not"),
    ];
    expect(assembleVerseText(lines)).toBe("I will observe thy statutes: Oh forsake me not");
    expect(assembleVerseText([poem("and flesh of my flesh"), poem("she shall be called")])).toBe(
      "and flesh of my flesh she shall be called",
    );
  });

  it("does not add a space when a piece already starts or ends with one", () => {
    expect(assembleVerseText(["Jesus said ", { text: "Follow me", wordsOfJesus: true }])).toBe(
      "Jesus said Follow me",
    );
    expect(assembleVerseText(["Jesus said", { text: " Follow me" }])).toBe("Jesus said Follow me");
  });
});

describe("assembleVerseText: punctuation", () => {
  it("never puts a space before closing punctuation that starts a piece", () => {
    expect(assembleVerseText(["Hello", { text: "," }, { text: "world" }])).toBe("Hello, world");
    expect(assembleVerseText(["Is it", { text: "?" }])).toBe("Is it?");
    expect(assembleVerseText(["the LORD", { text: "’s" }, "word"])).toBe("the LORD’s word");
    expect(assembleVerseText(["(see", { text: "this)" }])).toBe("(see this)");
  });

  it("keeps dashes and hyphens attached", () => {
    expect(assembleVerseText(["forgive sins”", { text: "—he said" }])).toBe(
      "forgive sins”—he said",
    );
    expect(assembleVerseText(["morning—", poem("the first day")])).toBe("morning—the first day");
    expect(assembleVerseText(["The pre-", "eminence"])).toBe("The pre-eminence");
  });

  it("puts a space after sentence punctuation and between a closing mark and the next word", () => {
    expect(assembleVerseText([poem("you have done this,"), poem("you are cursed")])).toBe(
      "you have done this, you are cursed",
    );
    expect(assembleVerseText([poem("be called ‘woman,’"), poem("for out of man")])).toBe(
      "be called ‘woman,’ for out of man",
    );
  });
});

describe("assembleVerseText: quotation marks", () => {
  it("opens a quotation after a space and attaches an opening mark to the word after it", () => {
    expect(assembleVerseText(["said to him,", { text: "“Follow me.”", wordsOfJesus: true }])).toBe(
      "said to him, “Follow me.”",
    );
    expect(assembleVerseText(["He said “", "Go”"])).toBe("He said “Go”");
    expect(assembleVerseText([{ text: "“Because", poem: 1 }, "‘Our Father"])).toBe(
      "“Because ‘Our Father",
    );
  });

  it("separates a closing quotation from the sentence that follows", () => {
    expect(
      assembleVerseText(["He called “night.”", { lineBreak: true }, "And there was evening"]),
    ).toBe("He called “night.” And there was evening");
  });
});

describe("assembleVerseText: Hebrew text", () => {
  it("puts a space between a line and the Hebrew letter heading that follows it (Psalm 119:8, ASV)", () => {
    const verse = [
      poem("I will observe thy statutes:"),
      { lineBreak: true },
      poem("Oh forsake me not utterly."),
      "ב BETH.",
    ];
    expect(assembleVerseText(verse)).toBe(
      "I will observe thy statutes: Oh forsake me not utterly. ב BETH.",
    );
  });

  it("keeps a combining vowel mark on its letter and separates Hebrew words", () => {
    expect(assembleVerseText(["ב", { text: "ְּ" }])).toBe("בְּ");
    expect(assembleVerseText(["אָב", { text: "בֵּן" }])).toBe("אָב בֵּן");
  });
});

describe("assembleVerseText: verses that were already correct are unchanged", () => {
  it("footnote markers still stand for a space", () => {
    expect(
      assembleVerseText([
        "In the beginning, God",
        { noteId: 0 },
        "created the heavens and the earth.",
      ]),
    ).toBe("In the beginning, God created the heavens and the earth.");
    expect(assembleVerseText(["His one and only", { noteId: 17 }, "Son"])).toBe(
      "His one and only Son",
    );
  });

  it("a single string, a trailing footnote and surrounding whitespace", () => {
    expect(assembleVerseText(["Jesus wept."])).toBe("Jesus wept.");
    expect(assembleVerseText(["  Jesus   wept.  ", { noteId: 2 }])).toBe("Jesus wept.");
  });

  it("empty, missing or unknown content gives an empty string", () => {
    expect(assembleVerseText([])).toBe("");
    expect(assembleVerseText(undefined)).toBe("");
    expect(assembleVerseText([{ unknown: true }, ""])).toBe("");
  });

  it("only ever adds spaces: removing all whitespace gives the same characters as the old rule", () => {
    const samples: unknown[] = [
      ["a", poem("b,"), { lineBreak: true }, "“c”", { noteId: 1 }, "—d"],
      [poem("x"), poem("y"), "z"],
      ["In the beginning, God", { noteId: 0 }, "created"],
    ];
    for (const sample of samples) {
      expect(assembleVerseText(sample).replace(/\s/g, "")).toBe(
        legacyText(sample).replace(/\s/g, ""),
      );
    }
  });
});

describe("BSB Genesis 1:5 (the verse that showed the bug)", () => {
  const content = [
    "God called the light “day,” and the darkness He called “night.”",
    { lineBreak: true },
    "And there was evening, and there was morning—the first day.",
    { noteId: 1 },
  ];

  it("no longer runs the closing quotation into the next sentence", () => {
    expect(legacyText(content)).toContain("night.”And");
    expect(assembleVerseText(content)).toBe(
      "God called the light “day,” and the darkness He called “night.” And there was evening, and there was morning—the first day.",
    );
  });

  it("reaches the Reader: the provider returns the repaired text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ chapter: { content: [{ type: "verse", number: 5, content }] } }),
      ),
    );
    const verse = await helloAoProvider.getVerse(
      { bookId: "genesis", bookName: "Genesis", chapter: 1, verse: 5 },
      "BSB",
    );
    expect(verse?.text).toContain("“night.” And there was evening");
  });
});

// Whole-Bible check on the three downloaded editions (outside the repo). Runs only when
// BIBLE_SOURCE_DIR points at the folder that holds ENGWEBP/BSB/eng_asv .complete.json files.
const SOURCE_DIR = process.env["BIBLE_SOURCE_DIR"];
const corpus = Boolean(SOURCE_DIR && existsSync(join(SOURCE_DIR, "BSB.complete.json")));
describe.skipIf(!corpus)("every verse of WEB, BSB and ASV", () => {
  it("only gains spaces, never loses or changes a character, and adds none before punctuation", () => {
    // The three indexed editions, plus the other three Reader editions when their files are present
    // (used only to check the Reader text; they are not imported or indexed).
    const ids = ["ENGWEBP", "BSB", "eng_asv", "eng_kjv", "eng_bbe", "eng_fbv"].filter((id) =>
      existsSync(join(SOURCE_DIR!, `${id}.complete.json`)),
    );
    for (const id of ids) {
      const json = JSON.parse(readFileSync(join(SOURCE_DIR!, `${id}.complete.json`), "utf8")) as {
        books: { chapters: { chapter: { content: { type: string; content?: unknown }[] } }[] }[];
      };
      let verses = 0;
      let changed = 0;
      let spaceBeforePunctuation = 0;
      const closing = / [,.;:!?”’)]/;
      for (const book of json.books) {
        for (const chapter of book.chapters) {
          for (const block of chapter.chapter.content) {
            if (block.type !== "verse") continue;
            verses += 1;
            const fixed = assembleVerseText(block.content);
            const old = legacyText(block.content);
            expect(fixed.replace(/\s/g, ""), `${id} characters`).toBe(old.replace(/\s/g, ""));
            if (fixed !== old) changed += 1;
            if (closing.test(fixed) && !closing.test(old)) spaceBeforePunctuation += 1;
          }
        }
      }
      console.info(
        `${id}: ${verses} verses, ${changed} repaired, ${spaceBeforePunctuation} with a new space before punctuation`,
      );
      expect(spaceBeforePunctuation, id).toBe(0);
      // Fewer verses are poetic in KJV/BBE/FBV, but some are repaired in every edition.
      expect(changed, id).toBeGreaterThan(["ENGWEBP", "BSB", "eng_asv"].includes(id) ? 1000 : 0);
    }
  }, 120_000);
});
