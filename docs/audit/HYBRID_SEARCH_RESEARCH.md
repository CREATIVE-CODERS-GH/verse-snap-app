# Hybrid Bible search — research and phased plan (free search first, AI only when necessary)

*Research and planning only. **No OpenAI call, no database migration, no application-code change, no full Bible download or import, no commit/push/deploy; the old Lovable project was not touched.** Read-only evidence gathered: the app's source, HelloAO's public metadata and documentation, 24 single-chapter fetches from HelloAO (4 chapters × 6 editions, to measure verse size), HTTP `HEAD` requests for file sizes, PostgreSQL/Supabase/OpenAI documentation, and a temporary offline test of the existing reference parser (deleted afterwards). Statements marked **[unverified]** could not be confirmed from a primary source. This is engineering research, not legal advice.*

---

## 1. What exists today

| Piece | Behaviour (from the code) |
|---|---|
| Search page (`src/routes/search.tsx`) | One bar. `classifyQuery` decides **reference** (opens the verse/chapter directly, free) or **description** (the paid AI path). **There is no free text search at all today**: anything that is not a recognised reference goes to AI. |
| Reference parsing (`parse-reference.ts`, `classify-query.ts`, `find-references.ts`) | Aliases, ordinals ("first corinthians"), spoken numbers ("john three sixteen"), light fuzzy matching, lead-in stripping ("find the verse…"); `findReferences` pulls references out of OCR text. No AI involved. |
| Bible text (`helloao-provider.ts`, `translations.ts`) | Six editions from `bible.helloao.org/api/{id}/{BOOK}/{chapter}.json`: KJAV (`eng_kjv`), BSB, WEB (`ENGWEBP`), ASV (`eng_asv`), BBE (`eng_bbe`), FBV (`eng_fbv`). Chapter-level fetches, in-flight sharing, device cache, Workbox 30-day cache. |
| Response contract | `ScriptureSearchResponse { results: [{translation, bookId, bookName, chapter, verse, reference, text}], failed, errorMessage? }`; AI references are verified against HelloAO before display. |
| Other consumers | Saved verses and history key on `(translation, book_id, chapter, verse)`; voice navigates to `/search?q=…`; camera uses `findReferences`. None depend on how results are found. |

### Gaps in the free reference path (tested offline, no AI)
These inputs are **misclassified as descriptions today**, so with AI on they would spend money for something a parser should handle:

| Input | Today | Should be |
|---|---|---|
| `psalms 23:1-6`, `matt 5:3-12`, `gen 1:1-3` (ranges) | description → AI | reference (range) |
| `3 john 4`, `jude 5` (single-chapter books, verse only) | description → AI | reference |
| `john`, `psalm`, `genesis`, `jude`, `ruth`, `esther` (book only) | description → AI | open the book / chapter 1 |
| `1 john 4:8 kjv` (edition suffix) | description → AI | reference + edition |
| `james 1 5 6` | description → AI | James 1:5-6 |
| `phillipians 4:13` | description → AI | Philippians 4:13 (a similar misspelling, `ephesions 2:8`, already works) |

Correctly handled already: `john 3:16`, `Jn 3 16`, `1 cor 13 4`, `rom8:28`, `second timothy 1 7`, `ps 119:105`, `Mt5`, `jhn 3:16`, `john three sixteen`, `luke twenty four`, `open john 3 16`, and none of `mark my words`, `john the baptist`, `acts of kindness`, `job loss`, `numbers game` were mistaken for references.

---

## 2. Does HelloAO support search?
**No.** The documented API is static JSON: `available_translations.json`, `{id}/books.json`, `{id}/{book}/{chapter}.json`, per-edition complete files (`/api/{id}/complete.json`, 5.8–8.2 MB each), plus datasets (for example cross references) and audio. Probes of `/api/search`, `/api/BSB/search`, `/api/search.json` and `/api/BSB/search.json` all returned 404; the docs never mention keyword or full-text search. HelloAO also publishes downloads (`api.zip` 1.5 GB, `bible.eng.db` 1.5 GB SQLite of all English translations); the per-edition `complete.json` files are all we would need. Its landing page states that caching, storing and downloading are allowed without expiry, that AO Lab adds no restrictions, and that "each text keeps its own notice"; the translation metadata carries a machine-readable `license` object per edition, and `sha256` checksums for integrity.

**Consequence:** free search must be built on our own index. The natural home is the Supabase Postgres we already run.

---

## 3. Licensing and legal risk

Metadata from HelloAO for our six editions (verses per edition: KJAV 31,102 · BSB 31,086 · WEB 31,103 · ASV 31,102 · BBE 31,102 · FBV 31,104; **186,599 in total**):

| Edition | HelloAO `license` | Other evidence | Risk of **storing + indexing + searching** |
|---|---|---|---|
| **KJAV** (KJV) | public domain; attribution not required; commercial use, derivatives allowed | eBible: public domain, but the Crown's letters patent still gives Cambridge UP, Oxford UP and Collins exclusive **printing** rights **in the UK**; "no effect outside the UK" | **Low.** Commonly done worldwide. UK-specific nuance; note it, and consider it if you launch in the UK |
| **BSB** | public domain; no attribution required | Official terms: text "dedicated to the public domain as of April 30, 2023… all uses permitted"; asks that modified text not use the "Berean" name | **Low.** Keep the displayed text unmodified |
| **WEB** (`ENGWEBP`) | public domain; no attribution | eBible public domain; the name "World English Bible" is meant for unmodified text **[unverified here]** | **Low.** Index lowercase/stemmed forms for matching only; display original text |
| **ASV** (1901) | public domain | — | **Low** |
| **BBE** | public domain per HelloAO / eBible | Published 1949/1965 by Cambridge UP; I could not load eBible's page to confirm its exact wording **[unverified]** | **Low–medium.** Keep it available for reading via HelloAO; defer indexing until its status is confirmed |
| **FBV** | **attribution required; copyleft: true; public domain: false** (commercial use and derivatives allowed) | CC BY-SA 4.0: attribution, indicate changes, **share-alike for adapted material** | **Medium.** A searchable index of FBV text may count as adapted material (share-alike) and needs attribution. Recommendation: **leave FBV out of the index** (still readable through HelloAO) unless you decide to comply deliberately |

Other points:
- HelloAO's terms allow us to store and cache; we should still honour "each text keeps its own notice" by showing each edition's name and license link (the metadata gives `licenseUrl`) in an About/Credits screen, and record the license JSON, source URL, checksum and import date per edition in a provenance table.
- Index only what we are allowed to; we never need to *display* more than a verse or short result list from our own copy, and we can keep displaying text from HelloAO as today.
- An index of lowercased/stemmed tokens (a `tsvector`) is derived data; it is a weaker copy than the text itself. If you ever want to minimise exposure further, store **only** the `tsvector` + reference and fetch display text from HelloAO.
- Your own copyright position as the app owner: the code and index design are yours; the scripture text stays under each edition's notice.
- Get a quick legal sanity check for BBE, FBV and the UK KJV nuance before launch; none blocks the development phases.

---

## 4. Supabase/PostgreSQL full-text search: feasible, with room to spare

**What Postgres gives us (official docs):** `to_tsvector`/`websearch_to_tsquery`/`phraseto_tsquery` (quoted phrases and adjacency `<->`), `ts_rank`/`ts_rank_cd` with A–D weights, generated `tsvector` columns, GIN indexes, language configurations (`english` stems; `simple` keeps every word as typed), prefix matching with `:*`; and **`pg_trgm`**: `similarity()`, `word_similarity()`, the `%` and `<%` operators, thresholds, GIN/GiST trigram indexes. The PostgreSQL manual itself recommends our typo strategy: build a **word table** from `ts_stat` over a `simple` tsvector, put a **GIN trigram index** on it, and match misspelled terms against it (optionally filtered by similar length), refreshing it when the corpus changes.

### Proposed schema (design only, not created)
- `bible_sources(translation, helloao_id, sha256, license jsonb, license_url, imported_at, verse_count)` — provenance.
- `bible_verses(translation, book_id, chapter, verse, text, tsv_en, tsv_simple)`, one row per (edition, verse), PK `(translation, book_id, chapter, verse)`; `tsv_en` = `english` config (stemmed, stop words removed: keyword recall) and `tsv_simple` = `simple` config (all words, exact order: reliable **phrase** matching and archaic KJV forms like "suffereth"). GIN index on each.
- `bible_words(word, freq)` from `ts_stat`, with a GIN trigram index: typo repair and out-of-vocabulary detection.
- `search_bible(query, translation, limit)` — a read-only SQL function doing the tiers in §5; RLS on, read-only; no user data.

### Expected storage
Measured on a small sample (4 chapters × 6 editions = 672 verse fetches' worth; no full Bible downloaded): **average verse = 117.6 characters, 22–26 words**. Estimates for all six editions (186,599 verses):

| Component | Estimate |
|---|---|
| Plain text | ≈ 22 MB |
| `tsv_en` + `tsv_simple` (≈ 150 B + ≈ 190 B per verse) | ≈ 28 + 35 MB |
| Row overhead + primary key | ≈ 18 MB |
| Two GIN indexes | ≈ 30–45 MB |
| `bible_words` + trigram index | ≈ 5 MB |
| **Total, six editions, both vectors** | **≈ 130–170 MB** |
| Four editions (KJAV, BSB, WEB, ASV) | ≈ 85–110 MB |
| One edition | ≈ 20–30 MB |
| Lean variant (no stored text, only `tsv_en`, fetch text from HelloAO) | ≈ 40–60 MB for six editions |

Constraints **[docs]**: Supabase **Free plan projects go read-only above 500 MB** of database size; Pro includes an 8 GB disk. Four editions (≈ 100 MB) fit comfortably in the free tier alongside current data, but we should (a) import **one edition first and measure** with `pg_database_size`, (b) keep a 200 MB self-imposed ceiling. These numbers are estimates; the one-edition spike replaces them with measurements.

### Typical performance
GIN lookups over ≈ 31 k–125 k verses answer in a few milliseconds; the whole pipeline is a handful of indexed queries. CPU cost is far below any AI call, so free search is cheap enough to run for every query.

---

## 5. How free search should work (tiers, all deterministic)

0. **Normalise:** lowercase, strip punctuation/diacritics, collapse spaces, strip conversational lead-ins (already implemented), cap at 200 characters.
1. **Reference parse** (no database): improved `parseReference` (fixes in §1). Reference ⇒ done, free, never AI.
2. **Exact phrase:** `phraseto_tsquery('simple', …)` against `tsv_simple` in all indexed editions (the user may quote any translation). Phrase hit ⇒ high confidence.
3. **All keywords:** `websearch_to_tsquery('english', …)` (AND of stems) against `tsv_en`; rank with `ts_rank_cd`.
4. **Typo repair:** tokens absent from `bible_words` are replaced by the nearest word by trigram `similarity()` (bounded edit distance and similar length), then tiers 2–3 are retried. Handles "lovd the wrld", "sheperd", "hart".
5. **Relaxed match:** OR of the rarer keywords, requiring a minimum share of the query's content words (IDF-like weights from `bible_words.freq`).
6. **Ranking:** `score = phrase bonus + keyword coverage + ts_rank_cd + small popularity prior (a curated list of the best-known verses) + bonus when several editions agree`; collapse the same verse across editions; ties by canon order. Return the user's selected edition's text.
7. **Output:** up to 8 verse references, each verified/displayed through the existing `bibleService.getVerse` path (so "Scripture text always comes from the Bible source" stays true), or snippet text from the index once checksums match HelloAO.

Searching **all** indexed editions but displaying the user's edition is a key quality gain: "love is patient" matches BSB/WEB wording even when KJAV ("charity suffereth long") is selected.

What it will not do: paraphrase and topic matching ("verse about courage when afraid", "payment for sin is death") has no shared vocabulary with the verse. That is the job left for AI.

---

## 6. Deciding whether a query needs AI — without calling AI

A deterministic **router** runs after the free tiers and uses only signals we already have:

| Signal | Computed from |
|---|---|
| Reference found | parser |
| Content words (stop words removed) | tokenizer |
| Out-of-vocabulary rate | `bible_words` lookup (after typo repair) |
| Phrase hit / keyword coverage of the best verse | search tiers |
| Score gap between #1 and #2 | ranking |
| Shape cues | question/topic cues ("about", "verse for", "when I feel…", emotion words), length |

| Outcome | Condition (starting thresholds, to calibrate) | Action |
|---|---|---|
| **REFERENCE** | parser succeeded | open it, no search, no AI |
| **FREE-CONFIDENT** | phrase hit, or best verse covers ≥ 80 % of content words with a clear gap | show results, **no AI offered** |
| **FREE-ADEQUATE** | some results, coverage 50–80 % | show results, offer "Try smart search" |
| **NEEDS-AI** | no or weak results, ≥ 3 content words, vocabulary mostly valid (a real sentence that shares no wording) | show whatever free results exist (maybe none) plus the "Try smart search" button |
| **REFINE** | fewer than 2 content words, no hits | ask for more words; no AI |
| **NONSENSE** | out-of-vocabulary rate above ~50 %, or mostly non-letters | friendly message; **never AI** |

**AI is never started automatically in the first versions:** the button is the explicit action (the same rule we just implemented for reloads and URLs). An opt-in "auto" mode for signed-in users can come later behind a flag. Calibration is free: run the 40-query evaluation set through the free engine offline and tune thresholds until, for example, ≤ 35 % of realistic queries are offered AI. My rough expectation from the set: exact, partial and typo queries (23 of 40) resolve free; paraphrases and topics (15 of 40) end at NEEDS-AI; nonsense (2 of 40) never reaches AI.

An optional later step is **embeddings** (semantic vectors) to answer paraphrases without a generative model: indexing all six editions costs roughly $0.11 once (about 5.6 million tokens at `text-embedding-3-small`'s $0.02 per million **[docs]**), and a query of about 15 tokens costs well under a thousandth of a cent; vectors need pgvector storage (≈ 32 MB per edition at 512 half-precision dimensions) **[estimate]**. It still calls OpenAI per query, so it would sit behind the same flags and quotas.

---

## 7. Protecting the $5 credit (layers, cheapest first)

1. Free-first pipeline: references and text matches never call AI (§5–6).
2. Router: nonsense, vague and over-long inputs never reach AI (existing 200-character cap).
3. Explicit action only: the "Try smart search" button, plus today's sessionStorage restore and in-flight sharing, so no accidental duplicates.
4. `AI_SEARCH_ENABLED` off by default; one-line kill switch.
5. Database quotas before any paid call (guest/user minute and day, global day and month) — unchanged.
6. **Add:** a shared **AI result cache** in Postgres keyed by the normalised query (candidate references only, 30-day expiry) so a popular paraphrase is paid for once for everyone. Privacy note: it stores the query text of AI-eligible searches; keep it exact-match, short-lived, and disclose it, or key it by hash only (no fuzzy reuse).
7. **Add:** a **cost-based breaker**: aggregate token/cost counters per day and month (no text) and refuse AI once an estimated spend cap is reached (for example $2 of the $5), stronger than counting requests.
8. **Add:** a **circuit breaker** (3 provider failures in 2 minutes ⇒ skip AI for 5 minutes).
9. Provider-side hard limit (OpenAI project limit $5, alert at $3).

---

## 8. Degradation modes (free search always works)

| Situation | Behaviour |
|---|---|
| AI disabled (`AI_SEARCH_ENABLED` off, no key) | Free results only; no error. The smart-search button is hidden or shown as unavailable |
| User/global quota exhausted | Free results plus a quiet note ("Smart search is resting for today"); button disabled |
| OpenAI outage, timeout, spend limit | Free results plus "Smart search is unavailable right now"; circuit breaker avoids repeated waits |
| Database unavailable | Fall back to the reference path and the existing AI path rules (AI still fail-closed on quota); show the standard friendly error |
| Supabase index not yet loaded | Router treats the free engine as "no index" and behaves like today (explicit AI button) |

---

## 9. Preserving the existing product

- **Response contract:** keep `results`, `failed`, `errorMessage`; add only **optional** fields: `source` (`reference`/`text`/`ai`/`mixed`), `canTryAi`, `aiStatus` (`off`/`available`/`used`/`limit`/`unavailable`). The current UI keeps working unchanged; the new button reuses the existing "Search" button pattern.
- **UI:** same search bar and result list. One added control: "Try smart search" when the router offers it.
- **Saved verses/history:** untouched (they key on edition + reference).
- **Voice:** descriptions go to the free engine automatically (free ⇒ safe to run from the URL); AI stays an explicit tap.
- **Camera/OCR:** keep `findReferences`; when no reference is found, run the recognised text through the **free phrase search** (a printed verse becomes searchable at zero cost).
- **HelloAO verification:** unchanged; the index only proposes references (like the AI does). Display text still comes from HelloAO until we choose to serve snippets from the index after checksum validation.

---

## 10. Phased plan

| Phase | Scope | Needs | Cost/risk |
|---|---|---|---|
| **A. Smarter references + router scaffold** | Fix the parser gaps in §1 (ranges, single-chapter books, bare book names, edition suffix, more misspellings); add the router outcome type and optional response fields; hide AI behind the explicit button; tests with the 40-query set | no database, no AI | none; stops avoidable AI spend immediately |
| **B. Index spike (one edition)** | Migration 7 (`pg_trgm`, tables, `search_bible`), a one-off import script reading HelloAO `complete.json` (checksum-verified), verification SQL, measure size and speed, run the 40-query set against it | your approval for migration + import; ~7 MB download | ≈ 20–30 MB DB; fully reversible |
| **C. Full free search** | KJAV, BSB, WEB, ASV (BBE after review, FBV deferred); phrase/keyword/typo/ranking tiers; multi-edition ranking; free-search rate limit; calibrated router; credits screen | Phase B results | ≈ 85–110 MB; low legal risk |
| **D. AI as the fallback** | Reconnect the existing OpenAI path behind the router; shared AI cache; cost breaker; circuit breaker; degradation messages; then the (approved-only) live smoke/eval to compare AI recall on the NEEDS-AI subset | explicit approval for any live call | small, bounded by the ledger |
| **E. Optional semantic layer** | Embeddings + pgvector for paraphrase/topic | decision after D's data | ≈ $0.11 once; ≈ 30–60 MB |

### Recommended next step
**Phase A.** It needs no database, no migration, no import and no OpenAI call; it fixes real defects (a range or a book name currently counts as an AI query), introduces the router and contract that every later phase plugs into, and can be fully tested for free with the 40-query set. Then Phase B as a single-edition spike to replace the size and quality estimates above with measurements.

### Decisions I need from you
1. Approve Phase A as the next implementation step.
2. Editions to index first (recommended: KJAV, BSB, WEB, ASV; defer BBE and FBV).
3. Whether to store verse text in our database (simpler, enables snippets, larger) or only the search vectors (smaller, text keeps coming from HelloAO). Recommendation: store text for the first spike, decide after measuring.
4. Whether AI may ever run automatically (recommendation: no, button only, revisit later for signed-in users).
5. Your tolerance for the AI-cache privacy trade-off (§7.6).
6. Whether to get a quick legal check on BBE, FBV and the UK KJV note before launch.

---

## Sources
HelloAO: [docs landing](https://bible.helloao.org/docs/), [translations reference](https://bible.helloao.org/docs/reference/translations/), [downloads](https://bible.helloao.org/docs/guide/downloads.html), and the live metadata at [available_translations.json](https://bible.helloao.org/api/available_translations.json). Licensing: [BSB terms and licensing](https://berean.bible/terms.htm), [BSB licensing](https://berean.bible/licensing.htm), [FBV copyright (eBible)](https://ebible.org/engfbv/copr.htm), [KJV on eBible](https://ebible.org/study/content/texts/eng-kjv2006/about.html). Database: [Supabase full-text search](https://supabase.com/docs/guides/database/full-text-search), [Supabase database size limits](https://supabase.com/docs/guides/platform/database-size), [PostgreSQL pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html). OpenAI embeddings pricing: [OpenAI pricing](https://developers.openai.com/api/docs/pricing).
