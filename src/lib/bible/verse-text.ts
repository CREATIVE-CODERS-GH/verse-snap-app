/**
 * Readable text of one verse from HelloAO's content pieces.
 *
 * A verse is a list of pieces: plain strings, `{ text }` pieces (poetry lines, words of Jesus,
 * acrostic headings), `{ lineBreak }` and `{ noteId }` markers. Pieces are separate runs of text, and
 * the source rarely puts whitespace between them ("…done this," + "you are cursed…"), so joining them
 * with nothing runs words together. Joining them all with a space would put a space before a comma
 * that starts a piece. So a space is added between two pieces only when neither already supplies one
 * and the join is not one that punctuation attaches across:
 *
 *   - the next piece starts with closing punctuation, a dash or a combining mark: no space
 *     (`sins”` + `—he said`, `word` + `’s`, a Hebrew letter and its vowel mark);
 *   - the previous piece ends with an opening quote or bracket, or a dash or hyphen: no space
 *     (`“` + `Go`, `pre-` + `eminence`).
 *
 * A `lineBreak` and a `noteId` stand for a space, as a footnote marker always did. Whitespace is
 * collapsed and the ends trimmed. Verses whose pieces already carry their spaces are unchanged.
 */

/** Characters that attach to the text before them. */
const ATTACHES_BACKWARD = /^[\p{M},.;:!?)\]}\u201d\u2019\u00bb\u203a\u2026\u2014\u2013-]/u;
/** Characters that attach to the text after them. */
const ATTACHES_FORWARD = /[\u201c\u2018([{\u00ab\u2039\u2014\u2013-]$/u;
const NEEDS_NOTHING = /^\s|\s$/;

function collect(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
  } else if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if ("noteId" in item || "lineBreak" in item) out.push(" ");
    else if (typeof item["text"] === "string") out.push(item["text"]);
    else if (Array.isArray(item["content"])) collect(item["content"], out);
  }
}

export function assembleVerseText(content: unknown): string {
  const pieces: string[] = [];
  collect(content, pieces);
  let text = "";
  for (const piece of pieces) {
    if (piece === "") continue;
    if (text === "") {
      text = piece;
      continue;
    }
    const joined =
      NEEDS_NOTHING.test(text.slice(-1) + piece.slice(0, 1)) ||
      ATTACHES_BACKWARD.test(piece) ||
      ATTACHES_FORWARD.test(text);
    text += joined ? piece : ` ${piece}`;
  }
  return text.replace(/\s+/g, " ").trim();
}
