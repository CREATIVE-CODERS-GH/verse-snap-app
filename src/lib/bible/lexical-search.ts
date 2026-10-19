import { fromApiBookId } from "./books";
import type { VerseRef } from "./types";

export interface ScriptureIndex {
  refs: string[];
  terms: Record<string, number[]>;
  editions: Record<string, number>;
}
export interface LexicalHit extends VerseRef {
  confidence: number;
}
const STOP_WORDS = new Set("a an the is are be to of and in for with that this it i me my you your verse bible about says say find show please".split(" "));
export function searchWords(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
}
// Includes transposed letters as well as one insertion, deletion or substitution.
export function oneTypo(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differing = [...left].flatMap((c, i) => c === right[i] ? [] : [i]);
    if (differing.length === 1) return true;
    const [a, b] = differing;
    return differing.length === 2 && a !== undefined && b === a + 1 && left[a] === right[b] && left[b] === right[a];
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  return shorter.slice(i) === longer.slice(i + 1);
}
function root(word: string): string {
  return word.length > 5 ? word.replace(/(ing|eth|ed|es|s)$/, "") : word;
}
export function searchIndex(index: ScriptureIndex, query: string): LexicalHit[] {
  const words = [...new Set(searchWords(query).filter(word => !STOP_WORDS.has(word)))].slice(0, 32);
  if (!words.length) return [];
  const vocabulary = Object.keys(index.terms);
  const scores = new Map<number, { weight: number; hits: number }>();
  for (const word of words) {
    const alternatives = new Map<number, number>();
    const terms = [word];
    // Preserve exact matches, but also recover inflections and common typos.
    if (word.length >= 4) {
      terms.push(...vocabulary.filter(term => term !== word && (root(term) === root(word) || oneTypo(word, term))));
    }
    for (const term of terms) {
      const ids = index.terms[term];
      if (!ids) continue;
      const rarity = Math.log(1 + index.refs.length / ids.length);
      const weight = rarity * (term === word ? 1 : 0.7);
      for (const id of ids) alternatives.set(id, Math.max(alternatives.get(id) ?? 0, weight));
    }
    for (const [id, weight] of alternatives) {
      const previous = scores.get(id) ?? { weight: 0, hits: 0 };
      scores.set(id, { weight: previous.weight + weight, hits: previous.hits + 1 });
    }
  }
  return [...scores].filter(([, value]) => value.hits >= Math.max(1, Math.ceil(words.length * 0.6)))
    .sort((a, b) => b[1].hits - a[1].hits || b[1].weight - a[1].weight || a[0] - b[0])
    .slice(0, 12).flatMap(([id, value]): LexicalHit[] => {
      const ref = index.refs[id];
      if (!ref) return [];
      const [bookId, chapter, verse] = ref.split(":");
      const book = fromApiBookId(bookId ?? "");
      if (!book) return [];
      return [{ bookId: book.id, bookName: book.name, chapter: Number(chapter), verse: Number(verse), confidence: value.hits / words.length }];
    });
}