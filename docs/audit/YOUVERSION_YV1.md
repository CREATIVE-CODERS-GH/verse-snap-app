# YouVersion editions — milestone YV-1 (local only)

NIV (YouVersion id 111) and AMP (1588) read through the YouVersion Platform, **off by default**, beside the
unchanged HelloAO six. Not committed, not deployed. TPT and NLT are excluded.

## Use it locally
`VITE_YOUVERSION_TRANSLATIONS=true npm run dev -- --port 8091` with `YOUVERSION_APP_KEY` in `.env.local`
(server only; `.env.local` is not edited by the app). Browser test: `npm run test:e2e:youversion`.

## Design
- `translations.ts`: `BIBLE_TRANSLATIONS` is still HelloAO's six (it drives free search, offline downloads
  and AI search). `YOUVERSION_EDITIONS` (NIV, AMP, with publisher notices) is separate; `readerTranslations()`
  adds it only when `YOUVERSION_TRANSLATIONS_ENABLED` (`youversion-schema.ts`). `resolveTranslation("NIV")`
  still throws, which keeps licensed text out of AI search and offline downloads.
- `service.ts` routes by edition; licensed editions skip offline storage and `chapterCache`.
- `youversion-provider.ts` (client) → POST server function `youversion.functions.ts` → `youversion.server.ts`
  (key + one `GET /v1/bibles/{id}/passages/{USFM}.{chapter}?format=html&include_headings=false&include_notes=false`).
  Failures return as data with fixed messages; the key and API error text are never returned.
- `youversion-html.ts` turns the chapter HTML into plain verses (markers `yv-v`); tags, headings, footnotes and
  scripts are dropped, so no API HTML is ever rendered.
- Attribution: `PublisherNotice` under the chapter text and on the verse page; copy/share text carries the notice.
- Saved verses and history store the reference only (empty `verse_text`) for licensed editions.

## What is deliberately not done
No offline download, IndexedDB/localStorage chapter storage, service-worker caching (the call is a POST), search
index, AI use, bulk export, or server-side caching. Footnotes and headings are not requested.

## Conditions still to confirm with YouVersion / publishers
1. Biblica text read was a template with placeholder notice wording; confirm the binding NIV terms (non-commercial,
   free, no ads/subscriptions; per-user cap of 2 chapters or 25 verses; branding clause).
2. Lockman (AMP): free, no third-party ads, large-portion download must be impractical, annual distribution
   report (due end of Feb), 30-day termination, YouVersion vetting.
3. Private Study Together rooms, short-lived caching, Search API use, and "personalized content through AI"
   scope are not addressed by the agreements.
4. Card Studio images carry the translation name but not the full notice; copy/share text does. Owner decision needed.
5. Do not set the flag in Preview or Production until the above are confirmed.

## YV-2 stabilisation (local)
- **Rate limiting** (`youversion-limits.ts`, in-memory, free): 60 requests/min per client (platform-vouched IP via
  `ai/client-ip.server.ts`), 240 upstream calls/min per server instance, and a pause after YouVersion's own 429
  (its `Retry-After`, capped at 120 s, default 30 s). Blocked callers get a friendly message and YouVersion is not
  called. **Limits:** counters live in one instance's memory. On Vercel each serverless instance has its own and a
  cold start resets them, so the real allowance is the limit times live instances; it guards against bursts and
  mistakes, not a determined client. If traffic needs a hard cap, move the counters to the existing Postgres
  rate-limit tables (needs approval).
- ~~Page-lifetime memo~~ **Removed in YV-3** (caching permission is unconfirmed); see YV-3 below.
- **Parser** (`youversion-html.ts`): bridged `v="3-4"` → one entry (`through`), found from either number; omitted
  verses (NIV: Mark 9:44, 46, Acts 8:37, Luke 17:36…) arrive as empty markers and are honestly "not in this
  edition"; AMP includes them; unnumbered psalm titles are not glued onto verse 1; poetry/paragraphs flatten to
  spaces like the HelloAO text. Footnotes/headings are not requested: neither the Biblica nor the Lockman agreement
  requires them (the TPT one does; TPT is excluded). Italics and words-of-Jesus styling are not kept (plain text).
  The live survey of 11 chapters × 2 editions found no bridged or non-numeric markers.
- **Compare**: NIV/AMP route through YouVersion, notices under each licensed card, copy actions append notices.
- **Image export**: `canExportImage()`; **NIV is disabled** (Biblica §1 excludes downloads of media files of the
  content; terms still a template) — Card Studio and the share card refuse to render it, share falls back to text
  with the notice. **AMP exports** with the full Lockman notice drawn legibly on every card.
- **Saved verses**: NIV/AMP are stored by reference; the list fetches a live preview through the chapter query
  (memory only) with the notice. Highlights likewise show a notice.
- **Journal**: the Reflect "quote" button inserts the reference only for licensed editions.
- Notices also added to: References explorer, cross-reference sheet, Reflect card, share sheet, text-size and
  voice-audio previews.

## Release blockers after YV-2 (superseded by the YV-3 matrix below)
1. Final Biblica NIV terms (template placeholders; non-commercial/free; 25-verse cap; branding; link requirement
   that an exported/copied text cannot satisfy).
2. Lockman: annual distribution report, YouVersion vetting, free + no third-party ads, download-impracticality.
3. YouVersion Platform terms: caching, Search API use, Study Together, scope of the AI restriction.
4. Decide whether NIV text copy/share is acceptable, and whether a real per-IP limiter is needed before Preview.

## YV-3: licensing compliance and Preview readiness (local)

### Account status (owner-confirmed, not independently verified)
The owner confirms the YouVersion Platform dashboard shows the **Biblica (NIV)** and **Lockman Foundation (AMP)**
licences as accepted/active, and that the registration answers chose the non-commercial, no-advertising options.
This is treated as confirmed *account* approval. It does not settle any publisher condition below, and nothing in
this document is legal approval for a feature whose permission is marked Open.

### Compliance matrix
Sources: the two agreements the licence records link to (read 2026-11; the Biblica text is a template with
placeholder notice wording). "Satisfied" means verified in the code and in the browser tests.

| Requirement | Source | NIV | AMP |
|---|---|---|---|
| Copyright notice displayed with the text | Biblica §8.B; Lockman notice clause | **Satisfied**: under the chapter, on the verse page, Compare, share sheet, saved/highlight previews, Reflect, previews | **Satisfied**: same places, plus drawn on every exported card |
| Link to the publisher | Biblica §7.A.3.a (one-step link); Lockman (clickable link to home page) | **Satisfied in the app** (Biblica link, new tab). **Open** for copied text: the link is appended as plain text, whether that meets "one-step link" is unconfirmed | **Satisfied** in the app (Lockman home page); the notice text names the site |
| Free of charge, no ads / fees | Biblica §1, §5.12; Lockman free + "no third-party advertising" | **Satisfied per owner's registration answers**; Verse Snap has no ads or fees today | Same |
| Limit on how much one person views | Biblica §5.11: 2 chapters or 25 verses, whichever is greater, at a time | **Satisfied by design**: reader shows one chapter; Compare/verse page one verse; cross-reference rows and explorer show references only; at most 10 saved/highlight previews | n/a |
| No download of media files of the content | Biblica §1 | **Satisfied**: NIV image export disabled, no offline, no storage | n/a |
| Making download of a large part difficult | Lockman | n/a | **Satisfied**: one chapter at a time, nothing stored or bulk-listed, rate-limited server route |
| No AI use of the text | Biblica §3.B; BroadStreet §2e (TPT) | **Satisfied**: never sent to AI; quote button inserts the reference only | **Satisfied** (same code; AMP's own clause is silent) |
| No stored copy / delete files on termination | Biblica §13.B.3 | **Satisfied**: reference-only storage, nothing persisted, no chapter caching | Same |
| Sharing outside the app | Biblica (not stated); Lockman (not stated) | **Disabled** (share sheet targets, share-as-image, system share, Card Studio) and (YV-4) Copy text for NIV, until Biblica confirms | **Allowed**: notice travels in the text; images carry the notice |
| Image export | Biblica §1; Lockman | **Disabled** | **Enabled**, notice legible (1080 px wide, 24 px) |
| Caching | not stated by either | **No retention**: no memo; React Query drops licensed data when no screen uses it (`gcTime 0`) | Same |
| Study Together / group use | not stated | **Not enabled** (`canUseInStudyTogether` is false; feature is off) | Same |
| Search indexing / Search API | not stated | **Not used** | **Not used** |
| Annual distribution report to Lockman (by end of Feb) | Lockman | n/a | **Open**: owner action |
| Notify Lockman of website URLs | Lockman, method 1 ("website … provided LOCKMAN is notified of those URLs") | n/a | **Open**: Verse Snap is a web app; unclear whether method 2 (mobile app) covers the PWA |
| "Uses the YouVersion Platform SDK to access" | Lockman | n/a | **Open**: Verse Snap calls the REST API directly, not an SDK |
| YouVersion vetting / termination on 30 days' notice | Lockman | n/a | **Open** (vetting completion is YouVersion's); termination risk accepted by owner |
| Use under the organisation's own name and branding | Biblica §1 | **Open**: unclear how this applies to an independent app via YouVersion | n/a |
| Footnotes | TPT agreement only | not required | not required |

### Remaining restrictions / unclear permissions (questions for YouVersion)
1. Biblica: final (non-template) notice wording; whether a plain-text link in copied text satisfies the one-step
   link; whether in-app Copy of a verse is allowed; when external sharing and image cards may be enabled.
2. Lockman: whether direct REST access satisfies "uses the YouVersion Platform SDK"; whether a PWA is a "website"
   needing URL notification; how the annual report is submitted (through YouVersion?).
3. Platform terms: caching (client or server), Search API use, private Study Together rooms, scope of the AI clause.
4. Whether the 25-verse / 2-chapter cap is per user across the whole app (this build keeps well inside it).

### Changes made in YV-3
- Chapter memo removed (only simultaneous identical requests share one call; the entry is dropped as soon as it
  settles). `query-policy.ts` sets `gcTime: 0, staleTime: 0` for NIV/AMP on every Scripture query root.
- NIV external sharing disabled (`canShareExternally`); share sheet shows an explanation; `shareVerseText` and
  `shareVerseCard` refuse. AMP copied text carries the notice; NIV copying was disabled in YV-4.
- Cross-reference rows and explorer cards are reference-only for licensed editions (also stops one request per row).
- At most 10 licensed previews per saved/highlight list.
- A device whose saved default is NIV/AMP falls back to KJAV while the flag is off (the stored choice is kept).
- Rate limiter unchanged.

### Retained after leaving a screen
Nothing licensed. Not in localStorage, IndexedDB, the service worker (the call is a POST), the server (only a
rate-limit counter and a one-request in-flight share), or React Query (dropped when unused).

## YV-4 — branch isolation and conservative safeguards (local)
- **Branch:** `feature/youversion-editions`, created locally from `origin/main` (`55e4d79`, which contains every
  commit of `origin/testing/vercel-mobile-preview` `3969bbf` plus the Voice & Audio merge #14). It holds only YouVersion
  files; no Study Together migration, schema or UI. Nothing committed or pushed.
- **NIV text copy is now disabled** (`copyText: false` in the catalogue, `canCopyText`): the share sheet has no Copy row,
  the verse page, chapter selection toolbar and quick actions, Compare and Card Studio Copy buttons are disabled and do
  nothing. Reason: Biblica's position on copying is unconfirmed. AMP and the free editions still copy; AMP copy carries
  the Lockman notice. NIV image export and external sharing remain disabled.
- Unchanged: rate limiter, no persistent licensed text, no extra caching, excluded from offline, AI and search index,
  flag off by default.
- The in-app copy question for Biblica (above) is now a request to re-enable, not a limitation of an enabled feature.
