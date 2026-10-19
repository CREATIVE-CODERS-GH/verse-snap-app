import asset from "./data/scripture-words.json.asset.json";
import { searchIndex, type ScriptureIndex } from "./lexical-search";

let pending: Promise<ScriptureIndex> | undefined;
export async function findIndexedReferences(query: string) {
  pending ??= fetch(asset.url, { signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error("Bible search index unavailable");
      return (await response.json()) as ScriptureIndex;
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    });
  return searchIndex(await pending, query);
}
