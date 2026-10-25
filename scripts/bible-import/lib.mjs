// Pure functions of the Bible import pipeline: parsing a HelloAO complete.json, validating it, and
// writing SQL. No network, no database, no credentials (see prepare-bible-import.mjs for the CLI).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(fs.readFileSync(path.join(here, "editions.json"), "utf8"));
export const USFM_BOOKS = CONFIG.books;

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Only an approved edition can be imported; anything else (pending, excluded, unknown) is refused. */
export function requireApproved(code) {
  const edition = CONFIG.editions[code];
  if (!edition) throw new ImportError("unknown_edition", `${code} is not a known edition`);
  if (edition.licenseStatus !== "approved") {
    throw new ImportError(
      "not_approved",
      `${code} is ${edition.licenseStatus}${edition.reason ? ` (${edition.reason})` : ""}; it cannot be imported`,
    );
  }
  return edition;
}

export class ImportError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "ImportError";
    this.kind = kind;
  }
}

/**
 * The text of one verse, for SEARCH and for the Reader: the SAME punctuation-aware assembly as
 * src/lib/bible/verse-text.ts (a test keeps the two identical). Pieces (poetry lines, quoted speech,
 * line breaks) are separated by a space unless punctuation attaches across the join.
 */
const ATTACHES_BACKWARD = /^[\p{M},.;:!?)\]}”’»›…—–-]/u;
const ATTACHES_FORWARD = /[“‘([{«‹—–-]$/u;
const HAS_EDGE_SPACE = /^\s|\s$/;

function collect(value, out) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collect(item, out);
  else if (value && typeof value === "object") {
    if ("noteId" in value || "lineBreak" in value) out.push(" ");
    else if (typeof value.text === "string") out.push(value.text);
    else if (Array.isArray(value.content)) collect(value.content, out);
  }
}

export function assembleVerseText(content) {
  const pieces = [];
  collect(content, pieces);
  let text = "";
  for (const piece of pieces) {
    if (piece === "") continue;
    if (text === "") {
      text = piece;
      continue;
    }
    const joined =
      HAS_EDGE_SPACE.test(text.slice(-1) + piece.slice(0, 1)) ||
      ATTACHES_BACKWARD.test(piece) ||
      ATTACHES_FORWARD.test(text);
    text += joined ? piece : ` ${piece}`;
  }
  return text.replace(/\s+/g, " ").trim();
}
export const searchText = assembleVerseText;
export const readerText = assembleVerseText;

/** The rule the Reader used before the fix (pieces joined with nothing between them). */
function legacyFlatten(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(legacyFlatten).join("");
  if (!value || typeof value !== "object") return "";
  if ("noteId" in value) return " ";
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.content)) return legacyFlatten(value.content);
  return "";
}
export const legacyReaderText = (content) => legacyFlatten(content).replace(/\s+/g, " ").trim();

// Control characters, soft hyphen, zero-width and bidi marks, line/paragraph separators, BOM, U+FFFD.
const UNUSUAL_RANGES = [
  [0, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];
const hasUnusual = (text) => {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (UNUSUAL_RANGES.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  }
  return false;
};

/**
 * Parses one complete.json (already JSON.parse'd) into verses and findings. Never throws for odd
 * content: it records it. Throws ImportError only when the file is not the expected edition at all.
 */
export function parseEdition(code, json) {
  const edition = requireApproved(code);
  const findings = {
    emptyVerses: [],
    duplicateReferences: [],
    gaps: [],
    nonIntegerVerseNumbers: [],
    outOfOrder: [],
    tooLong: [],
    unusualCharacters: [],
    nonNfc: [],
    nbsp: 0,
    readerGlued: [],
    unknownBlocks: {},
    headingBlocks: 0,
    subtitleBlocks: 0,
    countMismatches: [],
  };
  const translation = json?.translation;
  if (!translation || translation.id !== edition.helloaoId) {
    throw new ImportError(
      "wrong_edition",
      `file says translation "${translation?.id}", expected "${edition.helloaoId}": refusing to substitute another edition`,
    );
  }
  if (translation.shortName !== edition.shortName) {
    throw new ImportError(
      "wrong_edition",
      `short name "${translation.shortName}" is not "${edition.shortName}"`,
    );
  }
  if (!Array.isArray(json.books) || json.books.length !== 66) {
    throw new ImportError("bad_shape", `expected 66 books, found ${json.books?.length}`);
  }

  const verses = [];
  const seen = new Set();
  const chapters = new Map(); // "GEN 1" -> sorted verse numbers (including empty ones)
  const characters = new Map();
  let blocks = 0;

  json.books.forEach((book, index) => {
    if (book.id !== USFM_BOOKS[index]) {
      throw new ImportError(
        "bad_shape",
        `book ${index + 1} is "${book.id}", expected "${USFM_BOOKS[index]}"`,
      );
    }
    if (book.order !== index + 1) {
      throw new ImportError(
        "bad_shape",
        `book ${book.id} has order ${book.order}, expected ${index + 1}`,
      );
    }
    if (book.chapters.length !== book.numberOfChapters) {
      findings.countMismatches.push(
        `${book.id}: ${book.chapters.length} chapters listed, header says ${book.numberOfChapters}`,
      );
    }
    let bookVerses = 0;
    book.chapters.forEach((entry, chapterIndex) => {
      const chapter = entry.chapter;
      if (chapter.number !== chapterIndex + 1) {
        findings.countMismatches.push(
          `${book.id}: chapter ${chapterIndex + 1} is numbered ${chapter.number}`,
        );
      }
      const numbers = [];
      let previous = 0;
      let chapterBlocks = 0;
      for (const block of chapter.content) {
        if (block.type === "heading") findings.headingBlocks += 1;
        else if (block.type === "hebrew_subtitle") findings.subtitleBlocks += 1;
        else if (block.type !== "verse" && block.type !== "line_break") {
          findings.unknownBlocks[block.type] = (findings.unknownBlocks[block.type] ?? 0) + 1;
        }
        if (block.type !== "verse") continue;
        blocks += 1;
        bookVerses += 1;
        chapterBlocks += 1;
        const ref = `${book.id} ${chapter.number}:${block.number}`;
        if (!Number.isInteger(block.number) || block.number < 1 || block.number > 32767) {
          findings.nonIntegerVerseNumbers.push(ref);
          continue;
        }
        if (seen.has(ref)) {
          findings.duplicateReferences.push(ref);
          continue;
        }
        seen.add(ref);
        if (block.number < previous) findings.outOfOrder.push(ref);
        previous = Math.max(previous, block.number);
        numbers.push(block.number);

        const raw = searchText(block.content);
        if (raw !== legacyReaderText(block.content)) findings.readerGlued.push(ref);
        const text = raw.normalize("NFC");
        if (text !== raw) findings.nonNfc.push(ref);
        if (JSON.stringify(block.content).includes(String.fromCharCode(160))) findings.nbsp += 1;
        if (text === "") {
          findings.emptyVerses.push(ref);
          continue;
        }
        if (hasUnusual(text)) findings.unusualCharacters.push(ref);
        if (text.length > 4000) {
          findings.tooLong.push(ref);
          continue;
        }
        for (const ch of text)
          if (ch.charCodeAt(0) > 126) characters.set(ch, (characters.get(ch) ?? 0) + 1);
        verses.push({
          book: book.id,
          bookOrder: book.order,
          chapter: chapter.number,
          verse: block.number,
          text,
        });
      }
      chapters.set(`${book.id} ${chapter.number}`, numbers);
      if (typeof entry.numberOfVerses === "number" && entry.numberOfVerses !== chapterBlocks) {
        findings.countMismatches.push(
          `${book.id} ${chapter.number}: header says ${entry.numberOfVerses} verses, found ${chapterBlocks}`,
        );
      }
      const sorted = [...numbers].sort((a, b) => a - b);
      if (sorted.length && (sorted[0] !== 1 || sorted.at(-1) !== sorted.length)) {
        const missing = [];
        for (let n = 1; n <= sorted.at(-1); n += 1) if (!sorted.includes(n)) missing.push(n);
        findings.gaps.push(
          `${book.id} ${chapter.number}: starts at ${sorted[0]}, ends at ${sorted.at(-1)}, ${sorted.length} verses; missing ${missing.join(",") || "none"}`,
        );
      }
    });
    if (typeof book.totalNumberOfVerses === "number" && book.totalNumberOfVerses !== bookVerses) {
      findings.countMismatches.push(
        `${book.id}: header says ${book.totalNumberOfVerses} verses, found ${bookVerses}`,
      );
    }
  });

  if (blocks !== edition.expectedVerseBlocks) {
    findings.countMismatches.push(
      `file has ${blocks} verse blocks, expected ${edition.expectedVerseBlocks}`,
    );
  }
  if (chapters.size !== edition.expectedChapters) {
    findings.countMismatches.push(
      `file has ${chapters.size} chapters, expected ${edition.expectedChapters}`,
    );
  }
  return { verses, chapters, findings, characters, verseBlocks: blocks };
}

/** Chapter-level differences between two parsed editions: verse numbers present in one only. */
export function compareChapters(a, b) {
  const differences = [];
  const keys = new Set([...a.chapters.keys(), ...b.chapters.keys()]);
  for (const key of keys) {
    const left = a.chapters.get(key);
    const right = b.chapters.get(key);
    if (!left || !right) {
      differences.push({ chapter: key, onlyIn: left ? "first" : "second" });
      continue;
    }
    const l = new Set(left);
    const r = new Set(right);
    const onlyLeft = left.filter((n) => !r.has(n));
    const onlyRight = right.filter((n) => !l.has(n));
    if (onlyLeft.length || onlyRight.length) {
      differences.push({
        chapter: key,
        firstHas: left.length,
        secondHas: right.length,
        onlyInFirst: onlyLeft,
        onlyInSecond: onlyRight,
      });
    }
  }
  return differences;
}

// ---------- SQL output ----------
/** A SQL string literal. Refuses NUL; relies on standard_conforming_strings (the PostgreSQL default). */
export function sqlString(value) {
  if (value.includes("\u0000")) throw new ImportError("bad_text", "NUL character in text");
  return `'${value.replace(/'/g, "''")}'`;
}

export const CHUNK_SIZE = 2000;

/**
 * SQL files for one edition, as { name, sql } in load order:
 *   <code>_00_check.sql      refuses to run unless the source record is approved and matches this file
 *   <code>_NN.sql            one transaction per chunk, idempotent (safe to re-run after a failure)
 *   <code>_90_verify.sql     fails unless the rows loaded equal the manifest; rebuilds the vocabulary
 *   <code>_99_promote.sql    separate and manual: makes the edition searchable only if verified
 */
export function buildSql(code, parsed, source) {
  const edition = requireApproved(code);
  const files = [];
  const header = `-- ${code} (${edition.helloaoId}) import; source sha256 ${source.sha256}; generated by scripts/bible-import. Contains Bible text: keep out of git.\n`;
  files.push({
    name: `${code}_00_check.sql`,
    sql: `${header}do $$
begin
  if not exists (select 1 from public.bible_sources
                  where edition_code = ${sqlString(code)} and license_status = 'approved'
                    and source_sha256 = ${sqlString(source.sha256)}) then
    raise exception 'source record for ${code} is missing, not approved, or does not match this file';
  end if;
end $$;
`,
  });
  const chunks = Math.ceil(parsed.verses.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i += 1) {
    const part = parsed.verses.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const rows = part
      .map(
        (v) =>
          `(${sqlString(code)}, ${sqlString(v.book)}, ${v.bookOrder}, ${v.chapter}, ${v.verse}, ${sqlString(v.text)})`,
      )
      .join(",\n");
    files.push({
      name: `${code}_${String(i + 1).padStart(2, "0")}.sql`,
      sql: `${header}begin;
insert into public.bible_verses (edition_code, book, book_order, chapter, verse, verse_text) values
${rows}
on conflict (edition_code, book, chapter, verse) do update
  set verse_text = excluded.verse_text
  where public.bible_verses.verse_text is distinct from excluded.verse_text;
commit;
`,
    });
  }
  files.push({
    name: `${code}_90_verify.sql`,
    sql: `${header}do $$
declare n integer;
begin
  select count(*) into n from public.bible_verses where edition_code = ${sqlString(code)};
  if n <> ${parsed.verses.length} then
    raise exception '${code}: expected ${parsed.verses.length} verses, found %', n;
  end if;
  select count(distinct (book, chapter)) into n from public.bible_verses where edition_code = ${sqlString(code)};
  if n <> ${parsed.chapters.size} then
    raise exception '${code}: expected ${parsed.chapters.size} chapters with verses, found %', n;
  end if;
end $$;
select public.refresh_bible_words();
`,
  });
  files.push({
    name: `${code}_99_promote.sql`,
    sql: `${header}-- Run by hand, after ${code}_90_verify.sql passed. Makes ${code} searchable.
begin;
do $$
begin
  if (select count(*) from public.bible_verses where edition_code = ${sqlString(code)}) <> ${parsed.verses.length} then
    raise exception '${code}: verse count does not match the manifest; not promoting';
  end if;
end $$;
update public.bible_sources set status = 'active', imported_at = now()
 where edition_code = ${sqlString(code)} and license_status = 'approved' and source_sha256 = ${sqlString(source.sha256)};
commit;
`,
  });
  return files;
}

/**
 * Checks generated SQL files against the manifest (a loader must do this before running them, so a
 * file edited or truncated after generation is caught). Returns a list of problems; empty = fine.
 */
export function verifyOutputFiles(dir, manifestEdition) {
  const problems = [];
  for (const entry of manifestEdition.files) {
    const file = path.join(dir, entry.name);
    if (!fs.existsSync(file)) {
      problems.push(`${entry.name}: missing`);
      continue;
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.bytes)
      problems.push(`${entry.name}: ${bytes.length} bytes, manifest says ${entry.bytes}`);
    else if (sha256(bytes) !== entry.sha256)
      problems.push(`${entry.name}: checksum differs from the manifest`);
  }
  return problems;
}
