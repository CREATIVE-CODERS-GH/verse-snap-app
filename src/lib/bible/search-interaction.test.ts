import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREE_SEARCH_PREPARING_MESSAGE,
  SMART_SEARCH_LABEL,
  getFreeSearchProvider,
  preparingProvider,
} from "./free-search";
import { decideSubmit } from "./search-interaction";

// B0: Enter and Search start free search; AI is a separate, explicit "Try Smart Search" action.

describe("decideSubmit (Enter / Search)", () => {
  it("ignores empty input", () => {
    expect(decideSubmit("")).toEqual({ kind: "ignore" });
    expect(decideSubmit("   ")).toEqual({ kind: "ignore" });
  });

  it.each([
    ["john 3:16", "john"],
    ["psalms 23:1-6", "psalms"],
    ["ruth", "ruth"],
    ["3 john 4", "3john"],
    ["john 3:16 bsb", "john"],
    ["phillipians 4:13", "philippians"],
  ])("opens %s as a reference", (text, bookId) => {
    const action = decideSubmit(text);
    expect(action.kind).toBe("open_reference");
    if (action.kind === "open_reference") expect(action.reference.bookId).toBe(bookId);
  });

  it("keeps the edition named in the query", () => {
    const action = decideSubmit("john 3:16 bsb");
    expect(action.kind === "open_reference" && action.reference.translation).toBe("BSB");
  });

  it.each([
    "mark my words and listen carefully",
    "for God so loved the world",
    "verse about being thankful",
  ])("sends the description %s to free search", (text) => {
    const action = decideSubmit(text);
    expect(action.kind).toBe("free_search");
    if (action.kind === "free_search") expect(action.canOfferSmartSearch).toBe(true);
  });

  it("explains vague and nonsense queries instead of searching", () => {
    // One meaningful word is a keyword search now (free search, never Smart Search).
    expect(decideSubmit("love")).toMatchObject({ kind: "free_search", canOfferSmartSearch: false });
    expect(decideSubmit("the")).toMatchObject({ kind: "stop" });
    expect(decideSubmit("asdf qwerty zxcv")).toMatchObject({ kind: "stop" });
  });

  it("never returns an action that carries AI intent", () => {
    for (const text of ["john 3:16", "mark my words and listen carefully", "love", "asdf qwerty"]) {
      expect(Object.keys(decideSubmit(text)).join()).not.toMatch(/ai|paid|smart(?!Search)/i);
    }
  });
});

describe("free search while the index is unavailable", () => {
  it("reports that it is being prepared and returns no results", async () => {
    expect(getFreeSearchProvider()).toBe(preparingProvider);
    await expect(
      preparingProvider.search({ query: "mark my words and listen carefully", limit: 10 }),
    ).resolves.toMatchObject({ status: "preparing", results: [], total: 0, searchedEditions: [] });
  });

  it("uses the agreed wording", () => {
    expect(FREE_SEARCH_PREPARING_MESSAGE).toBe("Free Bible search is being prepared.");
    expect(SMART_SEARCH_LABEL).toBe("Try Smart Search");
  });

  it("does not use the network", async () => {
    // The shared test setup blocks fetch; a call would throw.
    await expect(
      preparingProvider.search({ query: "a real description of a verse", limit: 10 }),
    ).resolves.toMatchObject({ status: "preparing" });
  });
});

describe("AI is only started by the explicit Smart Search button", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("search page calls allowPaidSearch exactly once, inside startSmartSearch", () => {
    const source = read("src/routes/search.tsx");
    expect(source.match(/allowPaidSearch\(/g)).toHaveLength(1);
    const body = /const startSmartSearch = \(\) => \{([\s\S]*?)\n {2}\};/.exec(source)?.[1] ?? "";
    expect(body).toContain("allowPaidSearch(description, translation)");
  });

  const AI_WORDS = /allowPaidSearch|refetch|startSmartSearch|runSearch/;

  it("Enter, the search button and the suggestion chips share a submit path that cannot start AI", () => {
    const source = read("src/routes/search.tsx");
    const submit =
      /const submitSearch = \(text: string\) => \{([\s\S]*?)\n {2}\};/.exec(source)?.[1] ?? "";
    expect(submit).toContain("decideSubmit(");
    expect(submit).not.toMatch(AI_WORDS);
    expect(source).toMatch(/const pickSuggestion[\s\S]*?submitSearch\(suggestion\.query\)/);
    const form = /onSubmit=\{\(event[^)]*\) => \{([\s\S]*?)\n {10}\}\}/.exec(source)?.[1] ?? "";
    expect(form).toContain("submitSearch(query)");
    expect(form).not.toMatch(AI_WORDS);
  });

  it("the magnifier is the submit button, separate from Try Smart Search", () => {
    expect(read("src/components/search-field.tsx")).toMatch(
      /type="submit"[\s\S]*?aria-label="Search the Bible"/,
    );
    const source = read("src/routes/search.tsx");
    expect(source).toContain("onClick={startSmartSearch}");
    expect(source).toContain("SMART_SEARCH_LABEL");
  });

  it("voice search never grants paid-search intent", () => {
    expect(read("src/routes/voice.tsx")).not.toContain("allowPaidSearch");
  });

  it("no module besides the search page and the session store references paid intent", () => {
    const search = read("src/routes/search.tsx");
    expect(search).toContain("startSmartSearch");
    for (const file of [
      "src/routes/voice.tsx",
      "src/lib/bible/search-interaction.ts",
      "src/lib/bible/free-search.ts",
      "src/components/search-states.tsx",
      "src/components/search-field.tsx",
    ]) {
      expect(read(file)).not.toMatch(/allowPaidSearch|isPaidSearchAllowed/);
    }
  });
});

describe("a search submitted before hydration is not lost", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("the form is a plain GET to /search with the query named q", () => {
    const field = read("src/components/search-field.tsx");
    expect(field).toContain('method="get"');
    expect(field).toContain('action="/search"');
    expect(field).toMatch(/<input[\s\S]*?name="q"/);
    // Hydrated submissions are still handled in the page, not by the browser.
    expect(read("src/routes/search.tsx")).toContain("event.preventDefault()");
  });

  it("a reference arriving as ?q= opens once, after preferences load, replacing the entry", () => {
    const source = read("src/routes/search.tsx");
    const effect =
      /const handledUrlQuery = useRef[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\}, \[q, ready\]\);/.exec(
        source,
      )?.[1] ?? "";
    expect(effect).toContain("!ready");
    expect(effect).toContain("handledUrlQuery.current === q");
    expect(effect).toContain("decideSubmit(q)");
    expect(effect).toContain("{ replace: true }");
    // Only references open automatically; nothing here can start AI.
    expect(effect).not.toMatch(/allowPaidSearch|refetch|startSmartSearch|runSearch/);
  });

  it("the router sees the same decision for a native submission as for a hydrated one", () => {
    expect(decideSubmit("psalms 23:1-6").kind).toBe("open_reference");
    expect(decideSubmit("mark my words and listen carefully").kind).toBe("free_search");
    expect(decideSubmit("love").kind).toBe("free_search");
    expect(decideSubmit("the").kind).toBe("stop");
  });
});
