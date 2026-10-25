// Prepares the Bible search import for the APPROVED editions (WEB, BSB, ASV) and checks it.
//
//   node scripts/bible-import/prepare-bible-import.mjs --source-dir <dir> --out <dir> [options]
//
//   --edition CODE        edition to prepare (repeatable); default: every approved edition
//   --source-dir DIR      where the source files are kept / downloaded to (outside the repo)
//   --out DIR             where SQL chunks, manifest and report are written (outside the repo)
//   --download            fetch the source files from bible.helloao.org first (read-only network)
//   --accept-new-hash     accept a source whose SHA-256 differs from the pinned one (review first!)
//   --check-reader N|all  compare the rows with the reader's own chapter endpoint (network)
//
// It never connects to a database and holds no credentials: it writes SQL files for a person to
// review and load. Output contains Bible text: keep it out of git. Only unapproved editions are refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSql,
  compareChapters,
  CONFIG,
  ImportError,
  parseEdition,
  readerText,
  requireApproved,
  sha256,
} from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const multi = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const sourceDir = option("source-dir");
const outDir = option("out");
if (!sourceDir || !outDir) {
  console.error(
    "Usage: prepare-bible-import.mjs --source-dir <dir> --out <dir> [--edition WEB]... [--download]",
  );
  process.exit(2);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const dir of [sourceDir, outDir]) {
  if (path.resolve(dir).toLowerCase().startsWith(repoRoot.toLowerCase())) {
    console.error(`Refusing to write Bible text inside the repository: ${dir}`);
    process.exit(2);
  }
}
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const approved = Object.entries(CONFIG.editions)
  .filter(([, e]) => e.licenseStatus === "approved")
  .map(([code]) => code);
const requested = multi("edition").length ? multi("edition") : approved;

const HOST = "bible.helloao.org";
async function download(url, dest) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== HOST)
    throw new ImportError("bad_source", `refusing ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new ImportError("download", `${url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 50_000_000) throw new ImportError("download", "file is unexpectedly large");
  fs.writeFileSync(dest + ".part", bytes);
  fs.renameSync(dest + ".part", dest);
  return {
    url,
    bytes: bytes.length,
    sha256: sha256(bytes),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    downloadedAt: new Date().toISOString(),
  };
}

const report = { generatedAt: new Date().toISOString(), editions: {}, chapterDifferences: {} };
const manifest = { generatedAt: report.generatedAt, editions: {} };
const parsedByCode = {};
let failed = false;

for (const code of requested) {
  try {
    const edition = requireApproved(code);
    const file = path.join(sourceDir, `${edition.helloaoId}.complete.json`);
    const provFile = path.join(sourceDir, `${edition.helloaoId}.provenance.json`);
    let provenance = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, "utf8")) : {};
    if (flag("download")) {
      provenance = await download(edition.sourceUrl, file);
      const books = path.join(sourceDir, `${edition.helloaoId}.books.json`);
      await download(edition.booksUrl, books);
      fs.writeFileSync(provFile, JSON.stringify(provenance, null, 2));
    }
    if (!fs.existsSync(file))
      throw new ImportError("missing_source", `${file} not found (use --download)`);
    const bytes = fs.readFileSync(file);
    const actual = sha256(bytes);
    const hashOk = actual === edition.pinnedSha256;
    if (!hashOk && !flag("accept-new-hash")) {
      throw new ImportError(
        "checksum",
        `${code}: SHA-256 is ${actual}, pinned ${edition.pinnedSha256}. The source changed; review it, then re-run with --accept-new-hash and update editions.json and the source record.`,
      );
    }
    const parsed = parseEdition(code, JSON.parse(bytes.toString("utf8")));
    parsedByCode[code] = parsed;
    const f = parsed.findings;
    const hard =
      f.duplicateReferences.length +
      f.nonIntegerVerseNumbers.length +
      f.tooLong.length +
      f.outOfOrder.length +
      f.countMismatches.length;
    const source = { sha256: actual, bytes: bytes.length };
    const files = buildSql(code, parsed, source);
    const editionOut = path.join(outDir, code);
    fs.rmSync(editionOut, { recursive: true, force: true });
    fs.mkdirSync(editionOut, { recursive: true });
    for (const f2 of files) fs.writeFileSync(path.join(editionOut, f2.name), f2.sql);

    report.editions[code] = {
      identifier: edition.helloaoId,
      sourceUrl: edition.sourceUrl,
      noticeUrl: edition.noticeUrl,
      bytes: bytes.length,
      sha256: actual,
      pinnedSha256Matches: hashOk,
      publisherListedSha256: edition.publisherSha256,
      publisherChecksumReproduced: actual === edition.publisherSha256,
      etag: provenance.etag ?? null,
      lastModified: provenance.lastModified ?? null,
      downloadedAt: provenance.downloadedAt ?? null,
      verseBlocksInFile: parsed.verseBlocks,
      rowsToImport: parsed.verses.length,
      chapters: parsed.chapters.size,
      emptyVerses: f.emptyVerses,
      gapsInNumbering: f.gaps,
      duplicateReferences: f.duplicateReferences,
      readerWouldRunWordsTogether: f.readerGlued.length,
      headings: f.headingBlocks,
      psalmSubtitleBlocksNotIndexed: f.subtitleBlocks,
      nonAsciiCharacters: Object.fromEntries(
        [...parsed.characters].sort((a, b) => b[1] - a[1]).slice(0, 40),
      ),
      unusualCharacterVerses: f.unusualCharacters,
      nonNfcVerses: f.nonNfc,
      countMismatches: f.countMismatches,
      blocksWithUnknownType: f.unknownBlocks,
      hardProblems: hard,
    };
    manifest.editions[code] = {
      identifier: edition.helloaoId,
      licenseStatus: edition.licenseStatus,
      noticeUrl: edition.noticeUrl,
      source: {
        url: edition.sourceUrl,
        bytes: bytes.length,
        sha256: actual,
        etag: provenance.etag ?? null,
        lastModified: provenance.lastModified ?? null,
        downloadedAt: provenance.downloadedAt ?? null,
      },
      rowsToImport: parsed.verses.length,
      verseBlocksInFile: parsed.verseBlocks,
      chapters: parsed.chapters.size,
      files: files.map((x) => ({
        name: x.name,
        sha256: sha256(Buffer.from(x.sql)),
        bytes: Buffer.byteLength(x.sql),
      })),
    };
    console.log(
      `${code}: ${parsed.verses.length} rows from ${parsed.verseBlocks} verse blocks, ${parsed.chapters.size} chapters, ${files.length} SQL files, ${hard} hard problem(s)`,
    );
    if (hard) failed = true;
  } catch (error) {
    failed = true;
    console.error(
      `${code}: ${error instanceof ImportError ? `${error.kind}: ` : ""}${error.message}`,
    );
    report.editions[code] = { error: error.message, kind: error.kind ?? "unexpected" };
  }
}

// Chapter-level differences between editions (native numbering is kept; nothing is remapped).
const codes = Object.keys(parsedByCode);
for (let i = 0; i < codes.length; i += 1) {
  for (let j = i + 1; j < codes.length; j += 1) {
    const diff = compareChapters(parsedByCode[codes[i]], parsedByCode[codes[j]]);
    report.chapterDifferences[`${codes[i]} vs ${codes[j]}`] = diff;
    console.log(
      `${codes[i]} vs ${codes[j]}: ${diff.length} chapter(s) with different verse numbers`,
    );
  }
}

// Optional: every row must open in the reader. Compare with the reader's own chapter endpoint.
const readerOption = option("check-reader");
if (readerOption && codes.length) {
  const queue = [];
  for (const code of codes) {
    const parsed = parsedByCode[code];
    const byChapter = new Map();
    for (const v of parsed.verses) {
      const key = `${v.book} ${v.chapter}`;
      if (!byChapter.has(key)) byChapter.set(key, []);
      byChapter.get(key).push(v);
    }
    let keys = [...byChapter.keys()];
    if (readerOption !== "all") {
      const n = Number(readerOption);
      keys = keys
        .filter((_, idx) => idx % Math.max(1, Math.floor(keys.length / n)) === 0)
        .slice(0, n);
    }
    for (const key of keys) queue.push({ code, key, rows: byChapter.get(key) });
  }
  const results = { checkedChapters: 0, checkedRows: 0, problems: [] };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const item = queue[next++];
      const [book, chapter] = item.key.split(" ");
      const edition = CONFIG.editions[item.code];
      const url = `https://${HOST}/api/${edition.helloaoId}/${book}/${chapter}.json`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          results.problems.push({
            code: item.code,
            chapter: item.key,
            problem: `reader endpoint answered ${response.status}`,
          });
          continue;
        }
        const data = await response.json();
        const readerVerses = new Map();
        for (const block of data.chapter.content) {
          if (block.type !== "verse") continue;
          const text = readerText(block.content);
          if (text) readerVerses.set(block.number, text);
        }
        results.checkedChapters += 1;
        const ours = new Set(item.rows.map((r) => r.verse));
        for (const row of item.rows) {
          results.checkedRows += 1;
          if (!readerVerses.has(row.verse))
            results.problems.push({
              code: item.code,
              ref: `${item.key}:${row.verse}`,
              problem: "the reader has no such verse",
            });
        }
        for (const number of readerVerses.keys()) {
          if (!ours.has(number))
            results.problems.push({
              code: item.code,
              ref: `${item.key}:${number}`,
              problem: "the reader shows a verse that is not in the import",
            });
        }
      } catch (error) {
        results.problems.push({
          code: item.code,
          chapter: item.key,
          problem: `request failed: ${error.message}`,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  report.readerCheck = results;
  console.log(
    `reader check: ${results.checkedChapters} chapters, ${results.checkedRows} rows, ${results.problems.length} problem(s)`,
  );
  if (results.problems.length) failed = true;
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(`wrote ${path.join(outDir, "manifest.json")} and report.json`);
process.exit(failed ? 1 : 0);
