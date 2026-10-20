import type { BibleBook } from "./books";

/** Short name for compact controls: "Rom", "1 Cor", "Matt", but whole names for short books ("John"). */
export function shortBookName(book: Pick<BibleBook, "name" | "aliases">): string {
  if (book.name.length <= 5) return book.name;
  const alias = book.aliases.find((value) => value.length >= 3);
  if (!alias) return book.name;
  const digit = /^(\d)(.+)$/.exec(alias);
  const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return digit ? `${digit[1]} ${capitalise(digit[2] ?? "")}` : capitalise(alias);
}

const GOSPELS = new Set(["matthew", "mark", "luke", "john"]);
const PAULINE = new Set([
  "romans",
  "galatians",
  "ephesians",
  "philippians",
  "colossians",
  "titus",
  "philemon",
]);
const PAUL_NUMBERED = new Set([
  "1corinthians",
  "2corinthians",
  "1thessalonians",
  "2thessalonians",
  "1timothy",
  "2timothy",
]);
const GENERAL_NUMBERED = new Set(["1peter", "2peter", "1john", "2john", "3john"]);
const ORDINALS: Record<string, string> = { "1": "First", "2": "Second", "3": "Third" };

/** The label under the chapter heading, e.g. "Paul’s Letter to the Romans". */
export function bookLabel(book: Pick<BibleBook, "id" | "name">): string {
  if (GOSPELS.has(book.id)) return `The Gospel According to ${book.name}`;
  if (book.id === "acts") return "The Acts of the Apostles";
  if (book.id === "revelation") return "The Revelation of John";
  if (book.id === "hebrews") return "The Letter to the Hebrews";
  if (book.id === "james" || book.id === "jude") return `The Letter of ${book.name}`;
  if (PAULINE.has(book.id)) {
    const target = book.id === "titus" || book.id === "philemon" ? book.name : `the ${book.name}`;
    return `Paul’s Letter to ${target}`;
  }
  const numbered = /^(\d)(.+)$/.exec(book.id);
  if (numbered) {
    const ordinal = ORDINALS[numbered[1] ?? ""] ?? "";
    const rest = book.name.replace(/^\d\s*/, "");
    if (PAUL_NUMBERED.has(book.id)) {
      const target = book.id.includes("timothy") ? rest : `the ${rest}`;
      return `Paul’s ${ordinal} Letter to ${target}`;
    }
    if (GENERAL_NUMBERED.has(book.id)) {
      return book.id.endsWith("john") && !book.id.endsWith("1john")
        ? `The ${ordinal} Letter of John`
        : `The ${ordinal} Letter of ${rest}`;
    }
    return `The ${ordinal} Book of ${rest}`;
  }
  return `The Book of ${book.name}`;
}
