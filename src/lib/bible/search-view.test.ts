import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ErrorIllustration,
  LoadingState,
  ResultRowContent,
  StateMessage,
  SuggestionCard,
} from "@/components/search-states";
import { routeQuery } from "./search-router";
import { SEARCH_SUGGESTIONS } from "./search-suggestions";
import { deriveSearchView, type SearchViewInput } from "./search-view";

const base: SearchViewInput = {
  hasSubmitted: true,
  canTryAi: true,
  stopMessage: null,
  ready: true,
  canRun: false,
  isPending: false,
  isError: false,
  freeStatus: "preparing",
};
const view = (patch: Partial<SearchViewInput>) => deriveSearchView({ ...base, ...patch }).kind;

describe("deriveSearchView distinguishes every state", () => {
  it("initial: nothing submitted yet", () => {
    expect(view({ hasSubmitted: false })).toBe("initial");
  });

  it("hint: vague or nonsense queries explain what to change and never offer AI", () => {
    expect(view({ canTryAi: false, stopMessage: "Add a few more words." })).toBe("hint");
    expect(view({ canTryAi: false, stopMessage: null })).toBe("initial");
  });

  it("idle until preferences have loaded", () => {
    expect(view({ ready: false })).toBe("idle");
  });

  it("unindexed: a description while free search is being prepared", () => {
    expect(view({})).toBe("unindexed");
  });

  it("loading: only after Smart Search was requested and nothing has come back", () => {
    expect(view({ canRun: true, isPending: true })).toBe("loading");
    expect(view({ canRun: false, isPending: true })).toBe("unindexed");
  });

  it("results beat any failure (a good result is never hidden)", () => {
    const data = { resultCount: 2, failed: false };
    expect(view({ canRun: true, data })).toBe("results");
    expect(view({ canRun: true, data, isError: true })).toBe("results");
  });

  it("no_results: Smart Search ran and found nothing", () => {
    expect(view({ canRun: true, data: { resultCount: 0, failed: false } })).toBe("no_results");
  });

  it("network_error: the request itself failed", () => {
    expect(view({ canRun: true, isError: true })).toBe("network_error");
  });

  it("Smart Search unavailable, limit and other failures are separate states", () => {
    const failed = (aiStatus?: "off" | "unavailable" | "limit") => ({
      resultCount: 0,
      failed: true,
      aiStatus,
      errorMessage: "msg",
    });
    expect(view({ canRun: true, data: failed("off") })).toBe("smart_unavailable");
    expect(view({ canRun: true, data: failed("unavailable") })).toBe("smart_unavailable");
    expect(view({ canRun: true, data: failed("limit") })).toBe("smart_limit");
    expect(view({ canRun: true, data: failed() })).toBe("smart_failed");
  });

  it("never shows a Smart Search state unless Smart Search was requested", () => {
    const result = deriveSearchView({
      ...base,
      canRun: false,
      data: { resultCount: 0, failed: true, aiStatus: "off" },
    });
    expect(result.kind).toBe("unindexed");
  });
});

describe("suggestions", () => {
  it("keeps the approved labels", () => {
    expect(SEARCH_SUGGESTIONS.map((s) => s.label)).toEqual([
      "Peace",
      "Renewing your mind",
      "Comfort in trials",
      "John 3:16",
      "Hope",
    ]);
  });

  it("every underlying query is searchable: a reference, or a description the router accepts", () => {
    for (const suggestion of SEARCH_SUGGESTIONS) {
      const decision = routeQuery(suggestion.query);
      expect(decision.route === "reference" || decision.canTryAi, suggestion.query).toBe(true);
    }
  });

  it("the bare labels would not have been valid (why the queries differ)", () => {
    expect(routeQuery("Peace").canTryAi).toBe(false);
    expect(routeQuery("Hope").canTryAi).toBe(false);
  });
});

describe("search screen pieces (server-rendered markup)", () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
    renderToStaticMarkup(element);

  it("shows the translation label on a result", () => {
    const markup = html(
      createElement(ResultRowContent, {
        reference: "Romans 12:2",
        translation: "KJAV",
        text: "And be not conformed to this world",
      }),
    );
    expect(markup).toContain("Romans 12:2");
    expect(markup).toContain("KJAV");
  });

  it("shows no match badge unless match-level data is supplied", () => {
    const props = { reference: "Titus 3:5", translation: "KJAV", text: "text" };
    expect(html(createElement(ResultRowContent, props))).not.toMatch(
      /High match|Good match|Related/,
    );
    expect(html(createElement(ResultRowContent, { ...props, matchLevel: "high" }))).toContain(
      "High match",
    );
    expect(html(createElement(ResultRowContent, { ...props, matchLevel: "good" }))).toContain(
      "Good match",
    );
    expect(html(createElement(ResultRowContent, { ...props, matchLevel: "related" }))).toContain(
      "Related",
    );
  });

  it("loading state announces itself with the approved wording", () => {
    const markup = html(createElement(LoadingState));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Finding your verse…");
    expect(markup).toContain("This won&#x27;t take long.");
  });

  it("renders title, body and action of a state message", () => {
    const markup = html(
      createElement(
        StateMessage,
        {
          illustration: createElement(ErrorIllustration),
          title: "Connection problem",
          action: createElement("button", null, "Try Smart Search again"),
        },
        "We couldn't reach the Bible service.",
      ),
    );
    expect(markup).toContain("Connection problem");
    expect(markup).toContain("We couldn&#x27;t reach the Bible service.");
    expect(markup).toContain("Try Smart Search again");
  });

  it("renders the suggestion chips with their labels, not their queries", () => {
    const markup = html(
      createElement(SuggestionCard, { suggestions: SEARCH_SUGGESTIONS, onPick: () => undefined }),
    );
    expect(markup).toContain("Try searching for:");
    for (const suggestion of SEARCH_SUGGESTIONS) expect(markup).toContain(suggestion.label);
    expect(markup).not.toContain("verses about peace");
  });
});
