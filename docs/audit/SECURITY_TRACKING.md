# Dependency vulnerability tracking

*Opened 2026-10-19 during Phase 4, Step 3. Source: `npm audit` (read-only). `npm audit fix` has **not** been run, by instruction. Re-run `npm audit` after each dependency change and update this table.*

| Package | Severity | Advisory | Installed | Dependency path | Exposure | Planned resolution |
|---|---|---|---|---|---|---|
| `shell-quote` | **Critical** | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv): `quote()` command injection via a line terminator after a `{ comment }` token | 1.10.0 (affected range 1.8.4–1.10.0) | `@lovable.dev/vite-tanstack-config` → `@tanstack/devtools-vite` → `@tanstack/devtools-bundler-core` → `launch-editor` → `shell-quote` | Dev tooling only (editor-launch helper in the Vite dev server); not in the production bundle or server. Requires attacker-controlled input to `quote()`, which our code never supplies. | Disappears when `@lovable.dev/vite-tanstack-config` is removed in Phase 4 Step 6, provided `@tanstack/devtools-vite` is not re-added as a direct dev dependency; if it is, pin a patched `launch-editor`/`shell-quote` via `overrides`. Re-audit then. |
| `source-map-js` | **High** | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): event-loop DoS through indexed source-map section offsets | 1.2.1 (affected range 1.0.0–1.2.1) | `vite` → `postcss` → `source-map-js`; `@tailwindcss/vite` → `@tailwindcss/node` → `source-map-js` | Build-time only (CSS/source-map processing of our own files). A malicious source map would be needed. Not shipped to users. | Not removed by the Lovable work. Wait for a patched `source-map-js` and upgrade `postcss`/`vite`/`@tailwindcss/vite` via normal, tested dependency updates (or an `overrides` entry once a fixed version exists). Review at the start of Step 6 and before production deployment. |

## Notes
- Both entries show up as "fix available via `npm audit fix`"; applying it can move many transitive versions at once, so it is deferred to a deliberate, tested update (Step 6 or later).
- The earlier audit in this project (before the lockfile was rebuilt in Step 2b) showed only `source-map-js`. `shell-quote` most likely became visible because the previously incomplete `package-lock.json` was regenerated (npm audits the lockfile); I did not verify whether the package was already in `node_modules` beforehand.
- Neither affects the runtime that users reach (browser app and server functions). Treat them as build-pipeline hygiene, to be cleared before the first production deployment.
