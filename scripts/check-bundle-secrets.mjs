// Fails if a server secret from .env.local (or a key-shaped string) appears in the BUILT browser
// assets, or if a secret value appears anywhere in the server bundle. Run after `npm run build`:
//   npm run check:bundle
// Prints only file names and counts, never any secret value.
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const env = {};
try {
  for (const line of fs.readFileSync(path.join(repo, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
} catch {
  console.log("No .env.local found: scanning for key-shaped strings only.");
}

const SECRET_NAMES = ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_SALT"];
const secrets = SECRET_NAMES.map((name) => [name, env[name]]).filter(
  ([, value]) => value && value.length >= 8,
);
const shapes = {
  "OpenAI key (sk-...)": /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/,
  "Supabase secret key (sb_secret_...)": /sb_secret_[A-Za-z0-9_-]{10,}/,
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
}
const textual = (file) => /\.(js|mjs|cjs|html|css|json|map|txt|webmanifest)$/.test(file);

const browserDirs = [".output/public", "dist/client", ".vercel/output/static"].map((d) =>
  path.join(repo, d),
);
const serverDirs = [".output/server", ".vercel/output/functions"].map((d) => path.join(repo, d));

let problems = 0;
function scan(label, dirs, { names }) {
  const files = dirs.flatMap(walk).filter(textual);
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const rel = path.relative(repo, file);
    for (const [name, value] of secrets)
      if (text.includes(value)) found.push(`${name} VALUE in ${rel}`);
    for (const [name, re] of Object.entries(shapes))
      if (re.test(text)) found.push(`${name} in ${rel}`);
    if (names)
      for (const name of SECRET_NAMES)
        if (text.includes(name)) found.push(`${name} (name) in ${rel}`);
  }
  console.log(`${label}: ${files.length} files scanned, ${found.length} problem(s)`);
  for (const item of found) console.log(`   ! ${item}`);
  problems += found.length;
  return files.length;
}

const browserFiles = scan("Browser assets", browserDirs, { names: true });
scan("Server bundle", serverDirs, { names: false });
if (browserFiles === 0) {
  console.log("No browser assets found. Run `npm run build` first.");
  process.exit(2);
}
process.exit(problems === 0 ? 0 : 1);
