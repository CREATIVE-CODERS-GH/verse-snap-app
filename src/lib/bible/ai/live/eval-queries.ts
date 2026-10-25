/**
 * The 40-query evaluation set for AI Bible search (NOT run automatically; see eval.live.ts).
 * `expected` lists every reference accepted as a correct answer; an empty list means the right
 * behaviour is to propose nothing relevant (used to measure false positives).
 */

export type EvalCategory = "exact" | "partial" | "paraphrase" | "topic" | "typo" | "nonsense";

export interface EvalQuery {
  id: number;
  category: EvalCategory;
  query: string;
  expected: string[];
}

export const EVAL_QUERIES: EvalQuery[] = [
  {
    id: 1,
    category: "exact",
    query: "love is patient, love is kind",
    expected: ["1 Corinthians 13:4"],
  },
  {
    id: 2,
    category: "exact",
    query: "For God so loved the world that he gave his one and only Son",
    expected: ["John 3:16"],
  },
  {
    id: 3,
    category: "exact",
    query: "The Lord is my shepherd, I lack nothing",
    expected: ["Psalm 23:1"],
  },
  {
    id: 4,
    category: "exact",
    query: "I can do all things through Christ who strengthens me",
    expected: ["Philippians 4:13"],
  },
  {
    id: 5,
    category: "exact",
    query: "Do not be anxious about anything",
    expected: ["Philippians 4:6"],
  },
  {
    id: 6,
    category: "exact",
    query: "Be strong and courageous. Do not be afraid",
    expected: ["Joshua 1:9"],
  },
  {
    id: 7,
    category: "exact",
    query: "Trust in the Lord with all your heart and lean not on your own understanding",
    expected: ["Proverbs 3:5"],
  },
  {
    id: 8,
    category: "exact",
    query: "all things work together for good for those who love God",
    expected: ["Romans 8:28"],
  },
  {
    id: 9,
    category: "exact",
    query:
      "Do not conform to the pattern of this world but be transformed by the renewing of your mind",
    expected: ["Romans 12:2"],
  },
  {
    id: 10,
    category: "exact",
    query: "Now faith is confidence in what we hope for",
    expected: ["Hebrews 11:1"],
  },
  {
    id: 11,
    category: "exact",
    query: "In the beginning God created the heavens and the earth",
    expected: ["Genesis 1:1"],
  },
  { id: 12, category: "exact", query: "In the beginning was the Word", expected: ["John 1:1"] },
  {
    id: 13,
    category: "exact",
    query: "The Lord bless you and keep you",
    expected: ["Numbers 6:24"],
  },
  {
    id: 14,
    category: "exact",
    query: "Your word is a lamp to my feet and a light to my path",
    expected: ["Psalm 119:105"],
  },
  {
    id: 15,
    category: "exact",
    query: "For by grace you have been saved through faith",
    expected: ["Ephesians 2:8"],
  },
  {
    id: 16,
    category: "partial",
    query: "the fruit of the Spirit is love, joy, peace",
    expected: ["Galatians 5:22"],
  },
  { id: 17, category: "partial", query: "Jesus wept", expected: ["John 11:35"] },
  {
    id: 18,
    category: "partial",
    query: "ask and it will be given to you, seek and you will find",
    expected: ["Matthew 7:7"],
  },
  {
    id: 19,
    category: "partial",
    query: "come to me all you who are weary and burdened",
    expected: ["Matthew 11:28"],
  },
  {
    id: 20,
    category: "partial",
    query: "I am the way, the truth, and the life",
    expected: ["John 14:6"],
  },
  {
    id: 21,
    category: "paraphrase",
    query: "the payment for sin is death but God's gift is eternal life",
    expected: ["Romans 6:23"],
  },
  {
    id: 22,
    category: "paraphrase",
    query: "everyone has sinned and falls short of God's glory",
    expected: ["Romans 3:23"],
  },
  {
    id: 23,
    category: "paraphrase",
    query: "God loves someone who gives happily",
    expected: ["2 Corinthians 9:7"],
  },
  {
    id: 24,
    category: "paraphrase",
    query: "love the people who are your enemies and pray for those who hurt you",
    expected: ["Matthew 5:44"],
  },
  {
    id: 25,
    category: "paraphrase",
    query: "treat others the way you want to be treated",
    expected: ["Luke 6:31", "Matthew 7:12"],
  },
  {
    id: 26,
    category: "paraphrase",
    query: "let your good deeds shine so others see them and praise God",
    expected: ["Matthew 5:16"],
  },
  {
    id: 27,
    category: "paraphrase",
    query: "arrogance comes before a fall",
    expected: ["Proverbs 16:18"],
  },
  {
    id: 28,
    category: "paraphrase",
    query: "a gentle reply calms anger",
    expected: ["Proverbs 15:1"],
  },
  {
    id: 29,
    category: "paraphrase",
    query: "there is an appointed time for everything under heaven",
    expected: ["Ecclesiastes 3:1"],
  },
  {
    id: 30,
    category: "paraphrase",
    query: "those who hope in the Lord will renew their strength like eagles",
    expected: ["Isaiah 40:31"],
  },
  {
    id: 31,
    category: "topic",
    query: "verse about forgiving others",
    expected: ["Matthew 6:14", "Ephesians 4:32", "Colossians 3:13", "Luke 6:37", "Mark 11:25"],
  },
  {
    id: 32,
    category: "topic",
    query: "bible verse about courage when afraid",
    expected: ["Joshua 1:9", "Isaiah 41:10", "Psalm 27:1", "Deuteronomy 31:6", "2 Timothy 1:7"],
  },
  {
    id: 33,
    category: "topic",
    query: "verse about God's plan for my future",
    expected: ["Jeremiah 29:11", "Proverbs 3:5", "Romans 8:28"],
  },
  {
    id: 34,
    category: "topic",
    query: "verse about being thankful",
    expected: ["1 Thessalonians 5:18", "Psalm 107:1", "Colossians 3:17", "Philippians 4:6"],
  },
  {
    id: 35,
    category: "topic",
    query: "verse about marriage and love between husband and wife",
    expected: ["Ephesians 5:25", "Genesis 2:24", "1 Corinthians 13:4", "Proverbs 18:22"],
  },
  { id: 36, category: "typo", query: "for god so lovd the wrld", expected: ["John 3:16"] },
  { id: 37, category: "typo", query: "the lord is my sheperd", expected: ["Psalm 23:1"] },
  {
    id: 38,
    category: "typo",
    query: "trust in the lord with all your hart",
    expected: ["Proverbs 3:5"],
  },
  { id: 39, category: "nonsense", query: "purple elephant mortgage rates", expected: [] },
  { id: 40, category: "nonsense", query: "asdf qwerty zxcv", expected: [] },
];
