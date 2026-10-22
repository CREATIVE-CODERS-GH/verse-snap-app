# Next task

*Update this file at the end of every milestone; it is the first thing a new session reads.*

## Current objective
**Accept Batch 1E (Scripture cross-references) on Preview, then the owner deploys it.** Check on the
Preview: Romans 12:2 shows real related passages (Related passages link in the single-verse reader,
chips and Explore all in the chapter verse sheet), the Explorer opens with Old / New Testament groups, the
OpenBible.info and CC BY 4.0 credit links work (Explorer, sheet, Settings → About), and Back returns to
the reading position.

## Proposed next fix (not built): out-of-range cross-reference targets
About 0.03% of dataset targets run past a chapter's end in WEB/BSB/ASV/KJAV (for example Revelation
15:6–21, WEB Romans 16:25–27). Smallest safe handling, ~15 lines plus a test: where a passage's text is
fetched (`PassageRow` in `cross-reference-parts.tsx`, `PassageCard` in the Explorer route) clamp the end
verse to the chapter's last verse, and when the first verse does not exist in the selected edition show
"This passage isn't in this edition" instead of an error and link to the chapter instead of the verse.

## Pending follow-ups
- Reflect screen (`reflect.$translation.$book.$chapter.$verse.tsx`): the invalid-reference state has no
  recovery action; it is entered from the reader, so "Search Manually" should be primary.
- Live signed-in two-account test of the account journal and highlights on a Preview.

## Done and live
- Free Bible Search (WEB/ASV/BSB), Reflection Journal with account saving (Batch 1C), Reader improvements
  and Saved hubs (Batch 1D). Details in `docs/PROJECT_STATUS.md`.

## After that
Pending items in `docs/PROJECT_STATUS.md` (Phase B and KJAV search need separate approval).
