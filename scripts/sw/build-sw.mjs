// After `vite build`: writes /sw.js into the deployed static folder, listing every built JS/CSS file
// plus icons and the manifest, with a version that changes whenever any of them changes.
// Does nothing (and removes any stale sw.js) when the build is not an offline build (see flag.mjs).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { offlineSwBuild } from "./flag.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const candidates = [".vercel/output/static", ".output/public"].map((p) => path.join(root, p));
// The folder the current build wrote: the most recently modified one.
const outDir = candidates
  .filter((dir) => fs.existsSync(path.join(dir, "assets")))
  .sort(
    (a, b) =>
      fs.statSync(path.join(b, "assets")).mtimeMs - fs.statSync(path.join(a, "assets")).mtimeMs,
  )[0];
if (!outDir) {
  console.log("build-sw: no built static folder found; skipped");
  process.exit(0);
}

const swPath = path.join(outDir, "sw.js");
if (!offlineSwBuild()) {
  fs.rmSync(swPath, { force: true });
  console.log("build-sw: offline service worker is off for this build; no sw.js written");
  process.exit(0);
}

function list(dir, prefix, pattern) {
  const folder = path.join(outDir, dir);
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => `${prefix}${entry.name}`);
}

const files = [
  ...list("assets", "/assets/", /\.(js|css)$/),
  ...list("icons", "/icons/", /\.png$/),
  "/manifest.webmanifest",
  "/favicon.ico",
].filter((url) => fs.existsSync(path.join(outDir, url)));

const hash = createHash("sha256");
for (const url of files) hash.update(url).update(fs.readFileSync(path.join(outDir, url)));
const version = `${Date.now().toString(36)}-${hash.digest("hex").slice(0, 8)}`;

const template = fs.readFileSync(path.join(here, "sw.template.js"), "utf8");
fs.writeFileSync(
  swPath,
  template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(files, null, 2)),
);
console.log(`build-sw: wrote ${path.relative(root, swPath)} (${files.length} files, ${version})`);
