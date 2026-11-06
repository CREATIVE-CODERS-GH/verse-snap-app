/**
 * Turns a YouVersion chapter (`format=html`) into plain verses.
 *
 * The output is plain text only: every tag is discarded and nothing from the API is ever rendered as
 * HTML, so there is nothing to sanitise afterwards. Markup used, from the documented passage format:
 *   <span class="yv-v" v="3"></span>   starts verse 3 (empty marker)
 *   <span class="yv-vlbl">3</span>     the printed verse number (skipped)
 *   div.yv-h                           section headings (skipped; also not requested)
 *   span.yv-n                          footnotes (skipped; also not requested)
 * Inline styling (words of Jesus, italics, divine name) keeps its words and loses its styling, and
 * paragraph and poetry line breaks become single spaces: the same flat text the HelloAO editions give.
 *
 * Verse numbering follows the markers exactly and is never invented:
 *  - A bridged marker such as v="3-4" yields one entry for verse 3 with `through: 4`. The real
 *    text belongs to both verses; readers show it once and a lookup of verse 4 finds it.
 *  - A marker with no text (NIV leaves out verses such as Mark 9:44 and Acts 8:37) yields no entry,
 *    so the verse is honestly "not in this edition".
 *  - A psalm title (div.d) before verse 1 is unnumbered in these editions, so it is not part of
 *    verse 1, matching how the HelloAO editions treat it.
 */

export interface ParsedVerse {
  verse: number;
  /** Last verse of a bridged range ("3-4" gives verse 3, through 4). */
  through?: number;
  text: string;
}

const VOID_TAGS = new Set(["br", "hr", "img", "wbr"]);
const BLOCK_TAGS = new Set(["div", "p", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function classesOf(attributes: string): string[] {
  const match =
    /\bclass\s*=\s*"([^"]*)"/i.exec(attributes) ?? /\bclass\s*=\s*'([^']*)'/i.exec(attributes);
  return match?.[1] ? match[1].split(/\s+/).filter(Boolean) : [];
}

function verseMarker(attributes: string): { verse: number; through?: number } | null {
  const match = /\bv\s*=\s*"(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(attributes);
  if (!match?.[1]) return null;
  const verse = parseInt(match[1], 10);
  if (!Number.isInteger(verse) || verse < 1) return null;
  const through = match[2] ? parseInt(match[2], 10) : undefined;
  return through !== undefined && through > verse ? { verse, through } : { verse };
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseChapterHtml(html: string): ParsedVerse[] {
  const order: number[] = [];
  const texts = new Map<number, { text: string; through?: number }>();
  let preface = "";
  let current: number | null = null;
  let currentThrough: number | undefined;
  let buffer = "";

  const flush = () => {
    const text = tidy(buffer);
    buffer = "";
    if (!text) return;
    if (current === null) {
      preface = tidy(`${preface} ${text}`);
      return;
    }
    const existing = texts.get(current);
    if (existing === undefined) {
      order.push(current);
      texts.set(current, { text, ...(currentThrough ? { through: currentThrough } : {}) });
    } else {
      texts.set(current, { ...existing, text: tidy(`${existing.text} ${text}`) });
    }
  };

  const stack: { tag: string; skip: boolean }[] = [];
  const skipping = () => stack.at(-1)?.skip ?? false;
  const token = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|</g;

  for (let match = token.exec(html); match; match = token.exec(html)) {
    const text = match[4];
    if (text !== undefined) {
      if (!skipping()) buffer += decodeEntities(text);
      continue;
    }
    const tag = match[2]?.toLowerCase();
    if (!tag) continue; // a stray "<"
    const closing = match[1] === "/";
    const attributes = match[3] ?? "";

    if (closing) {
      // Pop to the matching open tag, tolerating sloppy nesting.
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index >= 0) stack.length = index;
      if (BLOCK_TAGS.has(tag)) buffer += " ";
      continue;
    }

    if (tag === "br") {
      buffer += " ";
      continue;
    }
    if (VOID_TAGS.has(tag) || /\/\s*$/.test(attributes)) continue;

    const classes = classesOf(attributes);
    if (tag === "span" && classes.includes("yv-v")) {
      const marker = verseMarker(attributes);
      if (marker !== null && !skipping()) {
        flush();
        current = marker.verse;
        currentThrough = marker.through;
      }
    }
    const skip =
      skipping() ||
      tag === "script" ||
      tag === "style" ||
      classes.includes("yv-vlbl") ||
      classes.includes("yv-n") ||
      classes.includes("yv-h") ||
      // A psalm title before verse 1 is unnumbered, not part of verse 1.
      (classes.includes("d") && current === null);
    stack.push({ tag, skip });
    if (BLOCK_TAGS.has(tag)) buffer += " ";
  }
  flush();

  const verses: ParsedVerse[] = order.map((verse) => ({ verse, ...texts.get(verse)! }));
  // Text before verse 1 that is not a psalm title (unexpected markup) stays with verse 1 rather than
  // being lost.
  if (preface && verses[0])
    verses[0] = { ...verses[0], text: tidy(`${preface} ${verses[0].text}`) };
  return verses.filter((item) => item.text);
}
