# Discover Search — Google Stitch screen specification

Mode on the existing **Search** screen. Reuses the approved Stitch patterns (screens 05, 15, 16, 19) and the
`vs-*` tokens; no new visual style. Light `#FFFFFF`, dark `#121212`. Build in Stitch as one screen with the
states below; the shipped implementation is `src/components/discover-search.tsx`.

## Frame (all states)
- Header: back arrow + "Search" (existing `ScreenHeader`).
- **Mode switch**: two-segment pill, `Discover | Verse Snap`, 40 px tall, full width, track `vs-container`,
  active segment `vs-primary` with `vs-on-primary` text. Same switch (with Verse Snap active) appears on the
  existing Search screen. Verse Snap mode is the existing screen unchanged.
- **Translation chips** (Discover only): `NIV` `AMP`, pill, 12 px type. Selected = `vs-primary` fill; unselected =
  1 px `vs-border`, `vs-surface` fill. Radio-group semantics.
- **Search field**: the existing pill input (48 px, magnifier left, clear button right). Placeholder
  "Search topics, verses, phrases…". Max 100 characters.
- Footer line: "Discover search is powered by YouVersion." 11 px, `vs-text-secondary`, centred.

## States

| # | State | Content |
|---|---|---|
| 1 | **Default** | Card "Trending searches": chips (`rounded-full`, 1 px border, 12 px medium) wrapped in rows. Tap = search. |
| 1a | Trending loading | Five pulsing pill skeletons (`vs-container`), `aria-busy`. |
| 1b | Trending unavailable | One line: "Trending searches aren't available right now. Type anything to search." Never substitute invented topics. |
| 1c | Trending error | Error text + outline "Try again" button. |
| 2 | **Typing** | Under the field, a list of rows separated by hairlines. Row 1 (bold): **Search for "typed text"**. Then up to 8 suggestions, 15 px. Small "Looking for suggestions…" status while loading; previous list stays (no flicker). Updates 300 ms after the last keystroke. |
| 3 | **Results** | Order: Did-you-mean line → **Related topics** → **Verses** → **Verse images**. |
| 3a | Did you mean | One line: "Did you mean **forgiveness**?" and/or "Search instead for **x**." Links in `vs-primary`, underlined. |
| 3b | Related topics | Heading "Related topics" 14 px semibold. Topic chip (primary-tinted border, semibold) followed by its subtopic chips (default chip). Tap = new search. |
| 3c | Verses | Heading "Verses". Rows use the existing result row: reference (15 px bold) + edition code (11 px) + 3-line preview (13 px, `vs-text-secondary`). Preview shows "Loading passage…" until fetched; rows past the 25th preview, or failed ones, read "Open to read this passage in NIV." Tap opens the existing reader at that verse. |
| 3d | Load more | Outline pill "Load more" (10 verses per page); "Loading…" while fetching; on failure "We couldn't load more verses." + "Try again". |
| 3e | Publisher notice | Biblica / Lockman copyright line under the verses (existing component). |
| 3f | Verse images | Heading "Verse images". 3-column grid (4 at ≥ 768 px), tiles keep the image's aspect ratio (9:16), 12 px radius. Caption under each tile (10 px): "Philippians 4:6–7 · © YouVersion". Pill "Show more images". No download, share or copy control. **NIV**: no grid; one line "Verse images aren't shown for NIV." |
| 4 | **Spelling** | State 3 with the did-you-mean line (3a) and results for the corrected meaning. |
| 5 | **Empty** | Existing no-results illustration, title "Nothing found", body "Discover couldn't find results for "x" in NIV. Try different words or a broader topic.", outline button "See trending searches". |
| 6 | **Loading** | Existing loading state (Stitch 15). |
| 7 | **Error** | Existing error illustration + title + body + primary "Try again" (hidden when retrying cannot help). Variants: offline ("You're offline"), connection problem, "That took too long", "Slow down a moment" (wait time from the service, in seconds or minutes), "Not available in NIV" (permission), "Discover isn't available". |

## Responsive
- **Mobile (default, 390 px):** single column, 20 px side gutters, as the rest of the app.
- **Tablet / desktop (≥ 768 px):** the app shell stays a centred column (max 30 rem) like every other screen;
  only the image grid grows from 3 to 4 columns. Chips wrap; nothing scrolls horizontally.
- Touch targets ≥ 40 px (chips are 32 px tall with 8 px gaps; the mode switch and rows are larger).
- Dark mode uses the same tokens; image tiles keep a `vs-container` placeholder behind the lazy image.

## Content rules
- Trending, suggestions, topics and spelling help come only from YouVersion's responses. No generic stock
  photos: images are YouVersion verse art with its credit line, or none.
- Licensed text is shown only as a short preview and is never copied, shared or stored from this screen.
