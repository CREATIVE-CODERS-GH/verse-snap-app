<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep enabled Bible editions and AO Lab IDs in `src/lib/bible/translations.ts`; one catalogue prevents mismatched text, labels, and translation selectors.
- Fetch book metadata per edition; navigation must respect the selected edition's chapter and verse structure.
- Keep full-corpus lexical search in a lazy CDN index generated from the translation catalogue; this avoids bundling Bible data with the app and recovers wording across editions.
- Treat lexical hits and model citations only as untrusted candidates and verify each in the selected AO Lab edition before display; this prevents generated or mismatched scripture.
