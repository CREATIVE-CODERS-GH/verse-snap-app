# Hybrid search, Phase A — implementation notes

*2026-10-19. Offline work only: no OpenAI call, no Bible dataset download or import, no migration, no Supabase change, no commit/push/deploy. `AI_SEARCH_ENABLED` is still `false` in `.env.local`; the manual spending ledger is unchanged ($0.000187).*

## Decisions recorded
1. Editions to index later: KJV (KJAV), BSB, WEB, ASV — **subject to a licensing review before any text is imported** (a hard gate for Phase B; checklist below).
2. The one-edition trial will store verse text next to the search vectors.
3. AI stays an explicit, user-triggered step. The router only *offers* it (`canTryAi`); nothing starts it.
4. The shared AI-result cache is deferred until privacy and retention rules are defined.

## What Phase A adds

### 1. Reference parser (`src/lib/bible/parse-reference.ts`)
The original parser is kept as `parseBasic`, behaviour frozen. A new extended grammar runs **only when the original returns nothing**, so anything that parsed before parses identically. Proof: a golden file (`__fixtures__/reference-golden.json`) captured from the original code before any change holds 3,297 inputs, of which the original accepted 3,183 (every book × name/alias/format variant plus spoken, OCR-style and edge cases). All 3,183 still return exactly the same result.

| Capability | Examples now handled |
|---|---|
| Verse ranges | `psalms 23:1-6`, `matt 5:3-12`, `gen 1:1-3`, `john 3:16 to 18`, `john chapter 3 verses 16 through 18`, `james 1 5 6`, `john 3:16b-18` |
| Cross-chapter ranges | `john 3:16-4:2` (`endChapter`, `endVerse`) |
| Chapter ranges | `psalm chapters 23-25`, `psalm 23 to 25` |
| Single-chapter books | `3 john 4`, `jude 5`, `jude 3-5`, `obadiah 15`, `philemon 6` |
| Bare book names (via `parseReferenceOrBook`, whole query only) | `john`, `ruth`, `psalms`, `1 john`, `the book of john`, `gospel of john`, `acts of the apostles`, `first book of samuel`, `st john` |
| Edition suffixes | `john 3:16 kjv`, `(bsb)`, `in the asv`, `from the berean standard bible`; unsupported editions (`niv`, `esv`, `new living translation`, …) are recognised and flagged, not mistaken for words |
| Alternate formats | `John 3.16`, `3,16`, `3;16`, `3 : 16`, `3 v 16`, `Jn3v16`, `I/II/III John`, `1st/2nd`, `Rom.`, `Revelations`, `Song of Songs`, `Saint/St. John`, `Gospel according to Luke` |
| Misspellings | explicit table (Phillipians, Ephesions, Galations, Collosians, Thesalonians, Corintians, Revalation, Deutronomy, Levitcus, Isiah, Ezekial, Habakuk, Mathew, Genisis, …) plus a bounded fuzzy match (long names, edit distance 2, single clear winner); flagged `corrected` |

`ParsedReference` gained optional fields only: `endVerse`, `endChapter`, `translation`, `unsupportedTranslation`, `bookOnly`, `corrected`.

**Deliberately kept or rejected**
- `John 3-16` keeps meaning John 3:16 (a common colloquial form the original parser already supported); a hyphen between two numbers right after the book is a verse separator. Chapter ranges need a word (`chapters 23-25`, `23 to 25`).
- Impossible ranges (backwards, beyond the book, verse 0 or above 176) return nothing.
- Bare names must be the **entire** query. Two-letter abbreviations (`ps`, `ex`, `is`, `pr`, …) are never accepted alone, and there is no prefix or fuzzy guessing for bare names.
- Ordinary phrases stay phrases: `mark my words`, `john the baptist`, `acts of kindness`, `job loss`, `numbers game`, `what is job`, `where is acts`, `james bond`, `luke warm`, `john 3 times`, `job 3 months ago`, `spider web`, … (33 phrase cases plus all 40 evaluation queries are tested).
- One judgement call: `philippines 4:13` is read as Philippians 4:13 (a very common slip). Say if you prefer it unparsed.
- `parseReference` (used by the live preview and by OCR `findReferences`) does not accept a bare book; only `classifyQuery`/the router do, so typing "job" does not flash a link and OCR text is not scanned for stray book words.

### 2. Deterministic router (`src/lib/bible/search-router.ts`)
`routeQuery(text, free?)` is pure: no network, no AI, no secrets, no database. Routes: `reference`, `free_confident`, `free_adequate`, `needs_ai`, `refine`, `nonsense`. Only `free_adequate` and `needs_ai` set `canTryAi`.
- **reference**: any parse above, plus `open/go to/read/find <book>`.
- **refine**: empty, fewer than two meaningful words (one is enough if framed as a topic, "verse about forgiveness"), or over 200 characters. Never offers AI.
- **nonsense**: keyboard runs (`asdf`, `qwer`, `zxcv`), vowel-less or repeated-character strings, mostly non-letters. Never offers AI.
- **needs_ai**: a real description with no free search available yet.
- Free-search signals (`phraseHit`, `bestCoverage`, `resultCount`, `scoreGap`, `outOfVocabularyRate`) are already accepted through the optional second argument and fully unit-tested with synthetic values, so Phase B/C only has to supply them. Thresholds live in `ROUTER_THRESHOLDS` for calibration.
- Offline result on the 40-query set: 0 treated as references; 39 `needs_ai`, 1 `nonsense` ("asdf qwerty zxcv"). (Distinguishing the remaining semantic nonsense, "purple elephant mortgage rates", needs the Bible vocabulary from Phase B.)

### 3. Response contract (`src/lib/bible/ai/types.ts`)
`ScriptureSearchResponse` gained optional `source`, `route`, `canTryAi`, `aiStatus` (`off`/`available`/`used`/`limit`/`unavailable`). The AI service now reports `aiStatus` (`off` when disabled/unconfigured, `limit` for quota denials, `unavailable` for outages or an unreadable quota, `used` with `source: "ai"` on success). Old shape still valid.

### 4. UI wiring (minimal)
- `search.tsx` uses the router: references open directly (including the edition named in the query, e.g. `john 3:16 bsb`), a book name opens chapter 1, a range opens its first verse. Vague and nonsense queries show a one-line hint instead of the "Press Search" AI prompt, so they can no longer spend credit.
- `voice.tsx` hands the search page only descriptions the router would offer AI for; references (now including bare book names) keep their existing path.
- Camera/OCR, saved verses, history and HelloAO verification are untouched.

## Tests (all offline; the network is blocked in `npm test`)
- 422 tests in 18 files pass (previously 205): +153 parser (golden compatibility, ranges, single-chapter books, bare names, editions, formats, misspellings, spoken forms, ambiguous phrases), +64 router (reference forms, phrases that resemble books, refine/nonsense, the 40-query set, synthetic free-search signals, AI-disabled behaviour, import purity), and updated service/query tests for the new response fields.
- AI-disabled behaviour: references are resolved by the router alone; a description is only offered AI; asking while disabled answers `aiStatus: "off"` and makes no provider or quota call; vague/over-long/nonsense queries never involve the service.
- `tsc` clean; `npm run build` passes (no new warnings); `npm run check:bundle` finds 0 problems; ESLint unchanged from baseline (167 pre-existing non-line-ending problems, no new ones).

## Known limitations
1. Free full-text search does not exist yet, so a real description still ends at "offer AI" (user-initiated).
2. Spoken ranges ("john three sixteen to eighteen") and comma lists ("john 3:16,18") are not supported; they fall through as before.
3. A range opens its first verse; the verse page does not yet display the whole range.
4. An unsupported edition suffix (`niv`) is recognised but the app silently uses the current edition; no notice is shown yet.
5. Semantic nonsense with real words is only identifiable once the Bible vocabulary exists (Phase B).
6. Misspelling coverage is a curated list plus bounded fuzzy matching, not exhaustive.
7. Thresholds in the router are starting values and must be calibrated against real free-search results.

## Licensing gate before importing any text (Phase B checklist)
- Re-verify each edition's notice from its source (`licenseUrl` in HelloAO metadata): KJAV, BSB, WEB, ASV public domain; confirm in writing before import.
- Record per edition: license JSON, `licenseUrl`, SHA-256 of the imported file, import date.
- Keep BBE and FBV out of the first import (BBE status unconfirmed; FBV is CC BY-SA with attribution/share-alike).
- Credits screen listing each edition with its notice; KJV UK printing-right note; keep displayed text unmodified; do not reuse "Berean"/"World English Bible" names for altered text.
- Decide the AI-cache privacy/retention policy before building the shared cache.

## Recommended next step
**Phase B, one-edition spike** (needs your approval and the licensing gate): migration 7 (`pg_trgm`, `bible_sources`, `bible_verses`, `bible_words`, `search_bible`), a one-off checksum-verified import of **one** edition (BSB or KJAV, about 7 MB), size and speed measurements, and the 40-query set run against it, feeding the router's `free` signals. Before that, a short browser check of the Phase A changes (below) is advisable.

## Quick browser check (free, no AI)
With `AI_SEARCH_ENABLED=false`: on `/search` try `psalms 23:1-6` (opens Psalm 23:1), `ruth` (opens Ruth 1), `3 john 4`, `john 3:16 bsb` (opens BSB), `phillipians 4:13`, then `love` and `asdf qwerty zxcv` (a hint, no "Search" button), and `mark my words and listen carefully`. Pressing Enter on a description is itself the explicit AI action (as before Phase A); with AI off it answers "Scripture search is not configured" and makes no OpenAI call. Reloading a `?q=` description URL starts nothing and shows "Press Search to find verses like this." Voice: say "John" (opens John 1).

## Update — B0 (2026-10-19)
The interaction described above changed in B0: Enter or the new **Search** button on a description starts *free* search (while the index is not installed it shows "Free Bible search is being prepared."); paid AI runs only from a separate **Try Smart Search** button. Voice no longer grants AI intent. See `PHASE_B_PLAN.md` and `PHASE_B_PREMIGRATION_REPORT.md`.
