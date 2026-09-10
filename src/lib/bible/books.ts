export interface BibleBook {
  /** URL-safe identifier, e.g. "john", "1corinthians" */
  id: string;
  name: string;
  chapters: number;
  /** Lowercase alternative spellings/abbreviations used by the reference parser */
  aliases: string[];
}

export const BIBLE_BOOKS: BibleBook[] = [
  { id: "genesis", name: "Genesis", chapters: 50, aliases: ["gen", "ge", "gn"] },
  { id: "exodus", name: "Exodus", chapters: 40, aliases: ["ex", "exo", "exod"] },
  { id: "leviticus", name: "Leviticus", chapters: 27, aliases: ["lev", "lv"] },
  { id: "numbers", name: "Numbers", chapters: 36, aliases: ["num", "nu", "nm"] },
  { id: "deuteronomy", name: "Deuteronomy", chapters: 34, aliases: ["deut", "dt", "deu"] },
  { id: "joshua", name: "Joshua", chapters: 24, aliases: ["josh", "jos"] },
  { id: "judges", name: "Judges", chapters: 21, aliases: ["judg", "jdg"] },
  { id: "ruth", name: "Ruth", chapters: 4, aliases: ["rth", "ru"] },
  { id: "1samuel", name: "1 Samuel", chapters: 31, aliases: ["1sam", "1sa", "isam"] },
  { id: "2samuel", name: "2 Samuel", chapters: 24, aliases: ["2sam", "2sa", "iisam"] },
  { id: "1kings", name: "1 Kings", chapters: 22, aliases: ["1kgs", "1ki"] },
  { id: "2kings", name: "2 Kings", chapters: 25, aliases: ["2kgs", "2ki"] },
  { id: "1chronicles", name: "1 Chronicles", chapters: 29, aliases: ["1chr", "1ch"] },
  { id: "2chronicles", name: "2 Chronicles", chapters: 36, aliases: ["2chr", "2ch"] },
  { id: "ezra", name: "Ezra", chapters: 10, aliases: ["ezr"] },
  { id: "nehemiah", name: "Nehemiah", chapters: 13, aliases: ["neh", "ne"] },
  { id: "esther", name: "Esther", chapters: 10, aliases: ["est", "es"] },
  { id: "job", name: "Job", chapters: 42, aliases: ["jb"] },
  { id: "psalms", name: "Psalms", chapters: 150, aliases: ["ps", "psa", "psalm", "pss"] },
  { id: "proverbs", name: "Proverbs", chapters: 31, aliases: ["prov", "pr", "prv"] },
  { id: "ecclesiastes", name: "Ecclesiastes", chapters: 12, aliases: ["eccl", "ecc", "ec"] },
  { id: "songofsolomon", name: "Song of Solomon", chapters: 8, aliases: ["song", "sos", "songofsongs"] },
  { id: "isaiah", name: "Isaiah", chapters: 66, aliases: ["isa", "is"] },
  { id: "jeremiah", name: "Jeremiah", chapters: 52, aliases: ["jer", "je"] },
  { id: "lamentations", name: "Lamentations", chapters: 5, aliases: ["lam", "la"] },
  { id: "ezekiel", name: "Ezekiel", chapters: 48, aliases: ["ezek", "eze", "ezk"] },
  { id: "daniel", name: "Daniel", chapters: 12, aliases: ["dan", "dn"] },
  { id: "hosea", name: "Hosea", chapters: 14, aliases: ["hos", "ho"] },
  { id: "joel", name: "Joel", chapters: 3, aliases: ["joe", "jl"] },
  { id: "amos", name: "Amos", chapters: 9, aliases: ["am"] },
  { id: "obadiah", name: "Obadiah", chapters: 1, aliases: ["obad", "ob"] },
  { id: "jonah", name: "Jonah", chapters: 4, aliases: ["jon", "jnh"] },
  { id: "micah", name: "Micah", chapters: 7, aliases: ["mic", "mc"] },
  { id: "nahum", name: "Nahum", chapters: 3, aliases: ["nah", "na"] },
  { id: "habakkuk", name: "Habakkuk", chapters: 3, aliases: ["hab", "hb"] },
  { id: "zephaniah", name: "Zephaniah", chapters: 3, aliases: ["zeph", "zep"] },
  { id: "haggai", name: "Haggai", chapters: 2, aliases: ["hag", "hg"] },
  { id: "zechariah", name: "Zechariah", chapters: 14, aliases: ["zech", "zec"] },
  { id: "malachi", name: "Malachi", chapters: 4, aliases: ["mal", "ml"] },
  { id: "matthew", name: "Matthew", chapters: 28, aliases: ["matt", "mt", "mat"] },
  { id: "mark", name: "Mark", chapters: 16, aliases: ["mk", "mrk", "mar"] },
  { id: "luke", name: "Luke", chapters: 24, aliases: ["lk", "luk"] },
  { id: "john", name: "John", chapters: 21, aliases: ["jn", "joh", "jhn"] },
  { id: "acts", name: "Acts", chapters: 28, aliases: ["ac", "act"] },
  { id: "romans", name: "Romans", chapters: 16, aliases: ["rom", "ro", "rm"] },
  { id: "1corinthians", name: "1 Corinthians", chapters: 16, aliases: ["1cor", "1co"] },
  { id: "2corinthians", name: "2 Corinthians", chapters: 13, aliases: ["2cor", "2co"] },
  { id: "galatians", name: "Galatians", chapters: 6, aliases: ["gal", "ga"] },
  { id: "ephesians", name: "Ephesians", chapters: 6, aliases: ["eph", "ep"] },
  { id: "philippians", name: "Philippians", chapters: 4, aliases: ["phil", "php", "pp"] },
  { id: "colossians", name: "Colossians", chapters: 4, aliases: ["col", "cl"] },
  { id: "1thessalonians", name: "1 Thessalonians", chapters: 5, aliases: ["1thess", "1th"] },
  { id: "2thessalonians", name: "2 Thessalonians", chapters: 3, aliases: ["2thess", "2th"] },
  { id: "1timothy", name: "1 Timothy", chapters: 6, aliases: ["1tim", "1ti"] },
  { id: "2timothy", name: "2 Timothy", chapters: 4, aliases: ["2tim", "2ti"] },
  { id: "titus", name: "Titus", chapters: 3, aliases: ["tit", "ti"] },
  { id: "philemon", name: "Philemon", chapters: 1, aliases: ["philem", "phm"] },
  { id: "hebrews", name: "Hebrews", chapters: 13, aliases: ["heb", "hb"] },
  { id: "james", name: "James", chapters: 5, aliases: ["jas", "jm"] },
  { id: "1peter", name: "1 Peter", chapters: 5, aliases: ["1pet", "1pe"] },
  { id: "2peter", name: "2 Peter", chapters: 3, aliases: ["2pet", "2pe"] },
  { id: "1john", name: "1 John", chapters: 5, aliases: ["1jn", "1jo"] },
  { id: "2john", name: "2 John", chapters: 1, aliases: ["2jn", "2jo"] },
  { id: "3john", name: "3 John", chapters: 1, aliases: ["3jn", "3jo"] },
  { id: "jude", name: "Jude", chapters: 1, aliases: ["jud", "jd"] },
  { id: "revelation", name: "Revelation", chapters: 22, aliases: ["rev", "re", "apocalypse"] },
];

export function findBook(id: string): BibleBook | undefined {
  return BIBLE_BOOKS.find((book) => book.id === id);
}

// USFM identifiers used by AO Lab, in canonical book order.
const API_BOOK_IDS = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI",
  "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG",
  "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC",
  "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT",
  "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI",
  "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
] as const;

export function toApiBookId(bookId: string): string | undefined {
  const index = BIBLE_BOOKS.findIndex((book) => book.id === bookId);
  return index >= 0 ? API_BOOK_IDS[index] : undefined;
}

export function fromApiBookId(apiId: string): BibleBook | undefined {
  const index = API_BOOK_IDS.indexOf(apiId.toUpperCase() as (typeof API_BOOK_IDS)[number]);
  return index >= 0 ? BIBLE_BOOKS[index] : undefined;
}
