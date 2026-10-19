import { writeFile } from "node:fs/promises";
import { BIBLE_TRANSLATIONS } from "../src/lib/bible/translations";

// This maintenance script runs with Bun, never in the published app.
const base = "https://bible.helloao.org/api";
const refs: string[] = [];
const refIds = new Map<string, number>();
const postings = new Map<string, Set<number>>();
const counts: Record<string, number> = {};
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join("");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if ("noteId" in item) return " ";
  return text(item["text"] ?? item["content"]);
}
async function json(url: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Bible source returned ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}
for (const edition of BIBLE_TRANSLATIONS) {
  const { books } = await json(`${base}/${edition.apiId}/books.json`);
  const tasks = books.flatMap((book: any) =>
    Array.from({ length: book.numberOfChapters }, (_, i) => ({ book: book.id, chapter: i + 1 })),
  );
  let next = 0;
  counts[edition.code] = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      const data = await json(`${base}/${edition.apiId}/${task.book}/${task.chapter}.json`);
      for (const block of data.chapter.content) {
        if (block.type !== "verse") continue;
        const words = text(block.content).toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
        if (!words.length) continue;
        const ref = `${task.book}:${task.chapter}:${block.number}`;
        let id = refIds.get(ref);
        if (id === undefined) { id = refs.length; refs.push(ref); refIds.set(ref, id); }
        counts[edition.code] = (counts[edition.code] ?? 0) + 1;
        const terms = new Set(words.filter(word => word.length > 1));
        words.slice(1).forEach((word, i) => terms.add(`${words[i]} ${word}`));
        for (const term of terms) {
          const existing = postings.get(term) ?? new Set<number>();
          existing.add(id); postings.set(term, existing);
        }
      }
    }
  }));
  console.log(edition.code, counts[edition.code], "verses indexed");
}
// Upload this temporary output with lovable-assets; never commit the raw corpus.
await writeFile("/tmp/scripture-words.json", JSON.stringify({
  source: base, editions: counts, refs,
  terms: Object.fromEntries([...postings].filter(([term, ids]) => !term.includes(" ") || (ids.size >= 2 && ids.size <= 15)).map(([term, ids]) => [term, [...ids].sort((a,b) => a-b)])),
}));
console.log("Complete", refs.length, "references", postings.size, "terms");