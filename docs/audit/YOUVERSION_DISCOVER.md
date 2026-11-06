# YouVersion Discover Search (off by default)

A second mode on the Search screen, **Discover**, beside Verse Snap's own search (unchanged). Branch
`feature/youversion-discover-search`. Screen spec for Stitch: `docs/design/DISCOVER_SEARCH_STITCH_SPEC.md`.

## Use it locally
`VITE_YOUVERSION_DISCOVER=true npm run dev -- --port 8091` with `VITE_YOUVERSION_TRANSLATIONS=true` and
`YOUVERSION_APP_KEY` in `.env.local`. Off unless **both** flags are set; with Discover off the Search screen has
no switch and is exactly as before (`npm run test:e2e:discover-off`).
URL: `/search?mode=discover&q=love&t=NIV` (any other `/search` URL is Verse Snap mode).

## Tests (no live traffic needed)
- `npm run test:e2e:youversion-discover` — the repeatable suite. It starts a **local mock of the YouVersion API**
  and a dev server pointed at it, drives the real UI in a browser, and counts exactly what reached the "upstream".
  58 checks: typing/debounce, suggestions, results, paging, previews and the 25-verse cap, image loading (the mock
  serves real PNGs that must decode), spelling help, topics, empty state, permission denied, **429 throttling
  shared with Bible reading**, offline, privacy and storage, request budgets.
- `src/lib/bible/youversion-discover.test.ts` — unit tests for every operation, error mapping, limits, shared
  cool-down, in-flight sharing and the API-address seam.
- `npm run test:e2e:youversion-discover-live` — **manual only**: real requests, counts against the shared quota
  (a couple of runs in a few minutes caused `429`, `Retry-After: 300`). Use a separate development key, once.
- The mock seam: `YOUVERSION_API_BASE_URL` is honoured only for `http://127.0.0.1|localhost|[::1]`, never on
  Vercel or in a production build (`youversion-base.server.ts`, unit-tested), so it cannot redirect the key.

## Endpoints (official docs: developers.youversion.com/search-apis and /guides/images)
Verified against the live API on 2026-11-06 for **NIV (111) and AMP (1588)**:

| Capability | Endpoint | NIV | AMP | Notes |
|---|---|---|---|---|
| Trending | `GET /v1/search-queries?trending=true&language_ranges[]=en` | ✓ | ✓ | Language only; 10 strings. `204` when none. |
| Suggestions | `GET /v1/search-queries?query=…&language_ranges[]=en` | ✓ | ✓ | Up to 25; sent from 2 characters. |
| Topics, subtopics, image ids, spelling | `GET /v1/search-unified` (`fields[]=topics&fields[]=images`) | ✓ | ✓ | Not paginated. `did_you_mean`, `search_instead_for`. |
| Verses, paginated | `GET /v1/search-verses` (`page_size=10`, `page_token`) | ✓ | ✓ | References only (`JHN.3.16`, `PHP.4.6-7`). |
| Verse text for a result | `GET /v1/bibles/{id}/passages/{ref}?format=text` | ✓ | ✓ | Plain text. AMP keeps its own `[amplifications]`. |
| Verse images | `GET /v1/images/{id}` per id | ✓ API | ✓ | `image_url` (cdn.youversion.com), `attribution`, aspect ratio. Ids are ~540 chars. |

**Not used:** `GET /v1/images` (collection), `search-images` (unified already gives ids), verse-of-the-day,
`user_intent`, the unified call's own `verses` (25 refs, no paging; `search-verses` is used so Load More pages
correctly), and any non-English `language_ranges`.

## Design
- `youversion-discover.functions.ts` (browser shell, POST) → `youversion-discover.server.ts` (key, HTTP, parsing).
  One validated request union; failures return as data with fixed wording; the key and API text are never returned.
- Results become Verse Snap references (`youversion-discover-refs.ts`) and open the existing reader.
- Queries use `networkMode: "always"` (offline shows "You're offline" instead of loading forever).

## Request volume (measured at the mock; what one search costs the shared quota)
| Journey | Upstream requests |
|---|---|
| Typing "love" | 2 (suggestions for "lov" and "love"; none for one letter; a replaced request is cancelled in the browser) |
| NIV search, first screen | **12** (1 verses + 1 topics/images + 10 visible previews). A phone shows ~3–8 rows, so typically 5–10. |
| NIV, scrolled through all 30 results | **29** (3 verses pages + 1 topics/images + 25 previews; results 26–30 never fetch text) |
| AMP images (12 shown) | **12** (6 image records per group, only when the image section is scrolled to) |
| Opening Discover, switching modes, offline, empty state | 1 trending / 0 / 0 / 2 |
Before lazy loading a first screen cost ~18. Identical requests are never repeated within a search (asserted).

## Quota protection (simple, in-memory, Vercel-compatible)
YouVersion publishes no numeric limit, but it answered a burst with `429`, `Retry-After: 300`.
1. **One shared cool-down.** Discover and Bible reading share `youVersionLimiter`'s cool-down. A 429 on either
   (honouring `Retry-After`, up to 5 minutes, default raised from 120 s) stops **both** from sending anything
   until it has passed; the person sees YouVersion's own wait ("about 5 minutes"). Unit- and browser-tested both ways.
2. **Discover has its own smaller budget:** 90 requests/minute per person and 150/minute per server instance
   (reader: 60 and 240), so a burst of searching cannot spend the whole instance allowance the reader needs.
   `DISCOVER_RATE_PER_CLIENT` / `DISCOVER_RATE_GLOBAL` override them. Placeholders until YouVersion gives a quota.
3. **Lazy loading:** passage text per verse only near the screen and only for the first 25 results; image
   records only near the screen, 6 at a time; suggestions from 2 characters after a 300 ms pause.
4. **No duplicate calls:** React Query shares identical queries; the server shares identical in-flight requests
   (nothing is kept afterwards); Load More is disabled while loading.
5. A request cancelled in the browser stops the browser waiting; the server call is not aborted (sharing makes
   that unsafe), which costs little because calls finish in about a second.

**These do not isolate Production.** Counters live in one serverless instance's memory (cold starts reset them;
instances multiply the allowance), and the reader and Discover still draw on **one YouVersion app key and quota**.
The cool-down protects reading *after* YouVersion throttles; it cannot prevent the throttle. **A separate
development/Preview key (ideally with its own quota) is still required** so testing and Previews can never
throttle Production reading, and the app's real quota should be agreed with YouVersion before public Discover use.
A shared limiter (the existing Postgres rate-limit tables) is the next step if traffic needs a hard cap.

## Licensing and storage rules kept
- No Scripture or search result is written to localStorage, IndexedDB, Cache Storage or an index (tested). Previews
  use the `discover-preview` query root (in `SCRIPTURE_QUERY_ROOTS`): dropped the moment no screen shows them.
  The server function is a POST (never cached by the service worker); the image CDN is cross-origin and ignored by it.
- Publisher notice under every verse list; previews capped at 25 verses per search (NIV: 2 chapters or 25 verses
  per person); no copy, share or export control on this screen.
- **Verse images** only where `canExportImage()` allows: **NIV not shown** (art carries NIV text), AMP shown with
  the YouVersion credit line on every tile; image URLs used exactly as returned and only from YouVersion's CDN.
- Excluded from free search, AI search, offline downloads and Study Together (tested by import checks).

## Preview deployment (protected, not done yet)
Vercel Authentication stays on. Set for the `feature/youversion-discover-search` Preview **only**:
`VITE_YOUVERSION_TRANSLATIONS=true`, `VITE_YOUVERSION_DISCOVER=true`, `YOUVERSION_APP_KEY=<a separate
Preview/development key>`. Do not set `VITE_YOUVERSION_DISCOVER` in Production. Verify on the Preview with the
mock-free manual checklist: Discover tab → trending, type, search, Load More, AMP images, NIV notice.

## Open questions
1. Quota and a separate key (above). 2. YouVersion's Search API and Verse Images terms for a third-party app
(caching, display, AI-personalisation scope). 3. NIV verse images (one switch: `imageExport` in `translations.ts`).
4. AMP annual distribution report and YouVersion vetting (YV-1). 5. Biblica/Lockman answers listed in YV-1.
