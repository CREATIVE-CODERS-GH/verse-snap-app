/**
 * Plain-text formatting for the Reflection Journal editor (Stitch Screen 24).
 *
 * The note is a plain textarea, so the toolbar writes lightweight markers that read naturally as
 * text and can later be rendered as rich text: **bold**, _italic_, "• " bullets and a quoted
 * scripture citation. Every function is pure: it takes the text and the selection and returns the
 * new text and selection.
 */

export type FormatKind = "bold" | "italic" | "bullet" | "quote";

export interface EditorState {
  text: string;
  start: number;
  end: number;
}

const MARKERS: Record<"bold" | "italic", string> = { bold: "**", italic: "_" };
const BULLET = "• ";

/** Words in a note, ignoring the formatting markers. */
export function countWords(text: string): number {
  const plain = text.replace(/\*\*|(^|\s)_|_(?=\s|$)|•/g, " ").trim();
  return plain ? plain.split(/\s+/).length : 0;
}

/** A note as plain text for previews and search: the bold and italic markers removed. */
export function plainNote(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(“"])_([^_\n]+)_(?=$|[\s.,;:!?)”"])/g, "$1$2")
    .replace(/\*\*/g, "");
}

export function wordCountLabel(count: number): string {
  return `${count} word${count === 1 ? "" : "s"}`;
}

function clampSelection({ text, start, end }: EditorState): EditorState {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text, start: a, end: b };
}

/** Wraps the selection in a marker, or removes it when the selection is already wrapped. */
function wrap(state: EditorState, marker: string): EditorState {
  const { text, start, end } = clampSelection(state);
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -marker.length) + selected + after.slice(marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }
  return {
    text: before + marker + selected + marker + after,
    start: start + marker.length,
    end: end + marker.length,
  };
}

/** Turns the selected lines into bullets, or back into plain lines when they all are bullets. */
function bullets(state: EditorState): EditorState {
  const { text, start, end } = clampSelection(state);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const allBullets = lines.every((line) => line.startsWith(BULLET));
  const changed = lines.map((line) =>
    allBullets ? line.slice(BULLET.length) : line.startsWith(BULLET) ? line : BULLET + line,
  );
  const block = changed.join("\n");
  const delta = block.length - (lineEnd - lineStart);
  const firstShift = allBullets ? -BULLET.length : lines[0]!.startsWith(BULLET) ? 0 : BULLET.length;
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: Math.max(lineStart, start + firstShift),
    end: end + delta,
  };
}

/** Inserts the verse as a quoted citation on its own line at the cursor. */
function quote(state: EditorState, citation: string): EditorState {
  const { text, start, end } = clampSelection(state);
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const trail = after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}${citation}${trail}`;
  const cursor = start + inserted.length;
  return { text: before + inserted + after, start: cursor, end: cursor };
}

export function applyFormat(state: EditorState, kind: FormatKind, citation = ""): EditorState {
  if (kind === "bullet") return bullets(state);
  if (kind === "quote") return quote(state, citation);
  return wrap(state, MARKERS[kind]);
}

/** The citation the quote button inserts: “verse text” — Reference (EDITION). */
export function scriptureCitation(text: string, reference: string, edition: string): string {
  return `“${text.trim()}” — ${reference} (${edition})`;
}

/** "#Faith" from user input such as "faith", "#faith " or "spiritual growth". */
export function normaliseTag(input: string): string | null {
  const words = input
    .replace(/#/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  const joined = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  return `#${joined.slice(0, 24)}`;
}
