# Camera OCR and Scripture search reliability

Improve the two existing lookup paths without changing Verse Snap’s visual direction or adding new product features.

## Camera and OCR

- Preprocess each captured/uploaded image locally: use the centered guide area for camera captures, upscale small text, convert to grayscale, normalize contrast, sharpen edges, and suppress light noise.
- Tune Tesseract for a short, single reference line while keeping OCR lazy-loaded, on-device, and terminating its worker after every scan.
- Make reference extraction tolerant of OCR punctuation, spacing, and common character mistakes. Resolve approximate book names only when the match is unambiguous, then validate chapter and verse through the existing parser.
- Auto-open a single clear, high-confidence result. For a plausible low-confidence result, show the existing quiet utility layout with the detected citation, **Open Verse**, and **Edit Reference**.
- Let **Edit Reference** expose a small manual reference field on the same screen. Keep existing multiple-result choice, retry/upload fallbacks, camera permissions, stream cleanup, and no photo persistence or upload.

## Natural-language search

- Accept arbitrary trimmed sentences up to a reasonable safety limit; remove the current implicit two-word rejection so single words and unfamiliar vocabulary can reach semantic search.
- Preserve reference-first routing for typed and spoken input, so valid references open immediately without any semantic request.
- Strengthen the candidate-only prompt for exact phrases, paraphrases, topics, modern-vs-KJV wording, inflections, and minor misspellings. Continue fetching every displayed verse from AO Lab and dropping unverified citations.
- Improve ranking with normalized tokens and light stemming/fuzzy word matching while retaining semantic candidate order as the primary signal.
- Surface Gateway failures clearly, with bounded retry only for 429/5xx; terminal errors are not retried. Missing configuration returns an explicit failure rather than a misleading empty result.
- Replace the no-match dead end with “Try describing the verse differently,” examples, and a retry action.

## Validation

- Add focused parser/reference-normalization checks for printed-style, handwriting-like, abbreviated, and imperfect OCR strings.
- Exercise direct typed/spoken references and confirm they bypass semantic search.
- Invoke the real semantic-search path for every requested phrase, including uncommon vocabulary and a misspelling, and verify returned text comes from the Bible service.
- Use browser checks for confirmation/edit behavior, search fallback, existing navigation, and console errors. Note that handwriting recognition itself remains dependent on image quality and requires final physical-device testing.
