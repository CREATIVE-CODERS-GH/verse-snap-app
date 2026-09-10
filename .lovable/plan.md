# Phase 6 — Natural scripture search

Let people type or say what they remember ("the verse about renewing your mind") and get a
short list of real verses to tap. Same look, same speed, no chatbot anywhere.

## What changes for the user

- Search field placeholder becomes "Enter a reference or describe a verse...". It stays a
  plain search field.
- Typing a reference (John 3:16, Hebrews 2:5) behaves exactly as today — instant reference
  result, no AI call.
- Typing a description and pressing search shows a plain "Relevant verses" list: reference,
  translation, and a one-line preview per row, tapping opens the existing verse page.
- Nothing found: "No matching verses found." plus "Try a different description or search by
  reference." and a Search again action.
- Voice: a spoken reference still opens the verse straight away; a spoken description
  ("find the verse about trusting God") lands on the same results list.

## How it works behind the scenes

1. **Intent split** — a new `classifyQuery` helper in the Bible layer runs the existing
   reference parser first. A clean parse wins and goes down the current path. Otherwise the
   text is treated as a description. Voice reuses the same helper, stripping lead-ins like
   "find the verse that says".
2. **Candidate lookup** — a server function `searchScripture` (`src/lib/bible/search.functions.ts`)
   asks the Lovable AI model for candidate *references only* (book, chapter, verse), never
   verse text, with a strict JSON schema.
3. **Verification against real scripture** — every candidate is fetched from the AO Lab
   source through the existing Bible service. Anything that does not resolve is dropped, so
   only genuine KJAV text is ever shown. No model-written text reaches the screen.
4. **Ranking** — exact phrase match of the query inside the verse text ranks first, then
   partial word overlap, then the model's own ordering. Max 8 results.
5. **Caching / cost control** — search runs only on submit (never per keystroke); results
   are cached by normalised query in React Query and in a small server-side in-memory map,
   so repeats cost nothing.

## Files

- `src/lib/bible/classify-query.ts` — new: reference vs description, voice lead-in stripping.
- `src/lib/bible/search.functions.ts` — new: server function, AI candidates, verification, ranking.
- `src/routes/search.tsx` — placeholder, submit handling, results list, empty/error states.
- `src/routes/voice.tsx` — route description-type speech to the results list.
- `roadmap.md` — Phase 6 checklist.

## Not included

No chat UI, no AI labels or badges, no explanations, devotionals or commentary, no query
history screen (recently viewed verses stays the only history), no new translations.
