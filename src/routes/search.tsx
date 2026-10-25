import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { CameraPromptCard } from "@/components/camera-prompt-card";
import { ScreenHeader } from "@/components/screen-header";
import { SearchField } from "@/components/search-field";
import {
  ERROR_TITLE_CLASS,
  ErrorIllustration,
  LoadingState,
  NoResultsIllustration,
  PILL_OUTLINE,
  PILL_PRIMARY,
  PreparingIllustration,
  StateMessage,
  SuggestionCard,
} from "@/components/search-states";
import {
  CorrectedQueryNote,
  ExactQueryNote,
  SearchResultsList,
  UnindexedNotice,
} from "@/components/search-results";
import { SparkleIcon } from "@/components/stitch-icons";
import {
  aiSearchQueryOptions,
  canRunAiSearch,
  logSearchDiagnostic,
} from "@/lib/bible/ai/search-query";
import {
  allowPaidSearch,
  browserSessionStorage,
  isPaidSearchAllowed,
  readSavedSearch,
} from "@/lib/bible/ai/search-session";
import {
  classifyFreeSearchError,
  FREE_SEARCH_PAGE_SIZE,
  FREE_SEARCH_PREPARING_MESSAGE,
  freeSearchInfiniteOptions,
  getFreeSearchProvider,
  resultSummary,
  searchedSummary,
  SMART_SEARCH_LABEL,
  SMART_SEARCH_OFFERED,
  unindexedNotice,
} from "@/lib/bible/free-search";
import { decideSubmit } from "@/lib/bible/search-interaction";
import { routeMessage, routeQuery } from "@/lib/bible/search-router";
import { SEARCH_SUGGESTIONS, type SearchSuggestion } from "@/lib/bible/search-suggestions";
import { deriveSearchView } from "@/lib/bible/search-view";
import { searchFreeBible } from "@/lib/bible/free-search.functions";
import { searchScripture } from "@/lib/bible/search.functions";
import { bibleService } from "@/lib/bible/service";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const value = search["q"];
    return typeof value === "string" && value.trim() ? { q: value } : {};
  },
  head: () => ({
    meta: [
      { title: "Search the Bible — Verse Snap" },
      {
        name: "description",
        content: "Enter a reference such as John 3:16, or describe the verse you remember.",
      },
      { property: "og:title", content: "Search the Bible — Verse Snap" },
      {
        property: "og:description",
        content: "Enter a reference such as John 3:16, or describe the verse you remember.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const [query, setQuery] = useState(q ?? "");
  const [submitted, setSubmitted] = useState(q ?? "");
  const { translation, ready } = usePreferences();
  const queryClient = useQueryClient();
  // Re-renders the page when the person asks for a search (the request itself is gated in search-query.ts).
  const [, setIntentVersion] = useState(0);
  const navigate = useNavigate();
  const router = useRouter();
  const runSearch = useServerFn(searchScripture);
  const result = useMemo(() => bibleService.parseReference(query), [query]);
  const trimmed = query.trim();

  useEffect(() => {
    if (q) {
      setQuery(q);
      setSubmitted(q);
    }
  }, [q]);

  // The deterministic router (no AI, no network) decides what kind of query this is.
  const submittedDecision = useMemo(() => (submitted ? routeQuery(submitted) : null), [submitted]);
  // Only a real description that could use AI help is searched; references, vague text and nonsense never are.
  const description = submittedDecision?.canTryAi ? submittedDecision.query : "";
  // Free search takes any meaningful query, even one word; Smart Search (above) needs a real description.
  const freeQuery = submittedDecision?.canSearchFree ? submittedDecision.query : "";
  const stopMessage = submittedDecision ? routeMessage(submittedDecision) : null;

  // A saved successful result for this exact search, if this tab already paid for it.
  const saved = useMemo(
    () =>
      ready && description
        ? readSavedSearch(browserSessionStorage(), description, translation)
        : null,
    [ready, description, translation],
  );
  const allowed = isPaidSearchAllowed(description, translation);
  const canRun = canRunAiSearch({ description, ready, allowed, saved });

  // A paid search runs only after preferences have loaded AND (a saved result exists OR the person
  // asked for it in this page session). See src/lib/bible/ai/search-query.ts.
  const search = useQuery(
    aiSearchQueryOptions({
      queryClient,
      description,
      translation,
      ready,
      allowed,
      saved,
      deps: {
        storage: browserSessionStorage(),
        log: logSearchDiagnostic,
        run: (query, edition) => {
          // Only the shape of the query is recorded, never the words themselves.
          trackEvent("semantic_search", { length: query.length });
          return runSearch({ data: { query, translation: edition } });
        },
      },
    }),
  );

  useEffect(() => {
    if (!ready || !description) return;
    if (saved) {
      logSearchDiagnostic({
        event: "restored_from_session",
        translation,
        queryLength: description.length,
      });
    } else if (!canRun) {
      logSearchDiagnostic({
        event: "waiting_for_user",
        translation,
        queryLength: description.length,
      });
    }
  }, [ready, description, translation, saved, canRun]);

  // Free search is what Enter and Search start. It runs on the server (see free-search.functions.ts);
  // until the index is switched on it answers "preparing". Pages of 25 are fetched as they are needed,
  // and a search that is replaced by a newer one is cancelled.
  const runFreeSearch = useServerFn(searchFreeBible);
  const freeProvider = useMemo(() => getFreeSearchProvider(runFreeSearch), [runFreeSearch]);
  // "Search instead for <original>": the person chose their own wording for this search. The corrected
  // spelling is remembered so they can switch back. A new search always starts with typos repaired.
  const [exactChoice, setExactChoice] = useState<{
    query: string;
    corrected: string | null;
  } | null>(null);
  const exact = exactChoice !== null && exactChoice.query === freeQuery;
  useEffect(() => setExactChoice(null), [freeQuery]);
  const freeSearch = useInfiniteQuery(
    freeSearchInfiniteOptions({
      provider: freeProvider,
      query: freeQuery,
      enabled: ready,
      repair: !exact,
    }),
  );
  const freePages = freeSearch.data?.pages ?? [];
  const firstFreePage = freePages[0];
  const lastFreePage = freePages.at(-1);
  const freeResults = freePages.flatMap((page) => page.results);
  const freeTotal = firstFreePage?.total ?? 0;
  const freeNotice = firstFreePage ? unindexedNotice(firstFreePage) : null;
  const freeSearched = searchedSummary(firstFreePage?.searchedEditions ?? []);
  // How many result rows are on screen; a new search starts again from the first page.
  const [shown, setShown] = useState(FREE_SEARCH_PAGE_SIZE);
  useEffect(() => setShown(FREE_SEARCH_PAGE_SIZE), [freeQuery]);
  // Reveal 10 more; when that passes what is loaded, fetch the next page from the server.
  const showMoreFree = () => {
    setShown((n) => n + FREE_SEARCH_PAGE_SIZE);
    if (
      freeResults.length < shown + FREE_SEARCH_PAGE_SIZE &&
      freeSearch.hasNextPage &&
      !freeSearch.isFetchingNextPage
    ) {
      void freeSearch.fetchNextPage();
    }
  };

  // The only place the search page asks for paid AI search: an explicit tap on "Try Smart Search".
  const startSmartSearch = () => {
    if (!description || search.isFetching) return;
    allowPaidSearch(description, translation);
    setIntentVersion((n) => n + 1);
  };

  const openReference = (
    reference: NonNullable<typeof result>,
    options?: { replace?: boolean },
  ) => {
    const replace = options?.replace ? { replace: true } : {};
    if (reference.verse === undefined) {
      navigate({
        to: "/chapter/$translation/$book/$chapter",
        params: {
          translation: reference.translation ?? translation,
          book: reference.bookId,
          chapter: String(reference.chapter),
        },
        ...replace,
      });
      return;
    }
    navigate({
      to: "/verse/$translation/$book/$chapter/$verse",
      params: {
        translation: reference.translation ?? translation,
        book: reference.bookId,
        chapter: String(reference.chapter),
        verse: String(reference.verse),
      },
      ...replace,
    });
  };

  // A search submitted before the page finished loading is sent by the browser as a plain form GET
  // (/search?q=...). A reference that arrives this way is opened now, once, replacing that entry so
  // Back does not return to it. Descriptions are left for the free-search states.
  const handledUrlQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!q || !ready || handledUrlQuery.current === q) return;
    handledUrlQuery.current = q;
    const action = decideSubmit(q);
    if (action.kind !== "open_reference") return;
    trackEvent("manual_search", { kind: "reference" });
    openReference(action.reference, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per URL query, after preferences load
  }, [q, ready]);

  // Enter, the search button and the suggestion chips all end here. None of them can start AI.
  const submitSearch = (text: string) => {
    const trimmedText = text.trim();
    const action = decideSubmit(trimmedText);
    if (action.kind === "ignore") return;
    trackEvent("manual_search", {
      kind: action.kind === "open_reference" ? "reference" : "description",
    });
    if (action.kind === "open_reference") {
      openReference(action.reference);
      return;
    }
    // Descriptions go to free search (see free-search.ts).
    setSubmitted(trimmedText);
    navigate({ to: "/search", search: { q: trimmedText }, replace: true });
  };

  const pickSuggestion = (suggestion: SearchSuggestion) => {
    setQuery(suggestion.query);
    submitSearch(suggestion.query);
  };

  // Back goes to the previous screen, or to Home when this page was opened directly.
  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else navigate({ to: "/", replace: true });
  };

  const results = search.data?.results ?? [];
  const view = deriveSearchView({
    hasSubmitted: Boolean(submitted),
    canTryAi: Boolean(submittedDecision?.canTryAi),
    canSearch: Boolean(submittedDecision?.canSearchFree),
    stopMessage,
    ready,
    canRun,
    isPending: search.isPending,
    isError: search.isError,
    data: search.data
      ? {
          resultCount: results.length,
          failed: search.data.failed,
          aiStatus: search.data.aiStatus,
          errorMessage: search.data.errorMessage,
        }
      : undefined,
    freeStatus: firstFreePage?.status ?? "preparing",
    free: freeQuery
      ? {
          isPending: freeSearch.isFetching && !freeSearch.data,
          isError: freeSearch.isError,
          errorKind: freeSearch.isError ? classifyFreeSearchError(freeSearch.error) : undefined,
          resultCount: freeResults.length,
        }
      : undefined,
  });

  const retryFreeSearch = (
    <button type="button" className={PILL_PRIMARY} onClick={() => void freeSearch.refetch()}>
      Try again
    </button>
  );
  const smartSearchButton =
    SMART_SEARCH_OFFERED && description ? (
      <button type="button" className={PILL_OUTLINE} onClick={startSmartSearch}>
        <SparkleIcon className="mr-2 h-4 w-4" />
        {SMART_SEARCH_LABEL}
      </button>
    ) : null;
  // Free search comes first; Smart Search is only ever a secondary, explicit choice.
  const freeActions = (
    <div className="flex w-full max-w-[260px] flex-col items-stretch gap-3">
      {retryFreeSearch}
      {smartSearchButton}
    </div>
  );

  // Typo repair wording: "Showing results for shepherd / Search instead for sheperd", and back again.
  const queryNote = exact ? (
    <ExactQueryNote
      original={freeQuery}
      corrected={exactChoice?.corrected ?? null}
      onUseCorrected={() => setExactChoice(null)}
    />
  ) : firstFreePage?.correctedQuery ? (
    <CorrectedQueryNote
      corrected={firstFreePage.correctedQuery}
      original={freeQuery}
      onUseOriginal={() =>
        setExactChoice({ query: freeQuery, corrected: firstFreePage.correctedQuery ?? null })
      }
    />
  ) : null;
  const retrySmartSearch = (
    <button type="button" className={PILL_OUTLINE} onClick={() => void search.refetch()}>
      {SMART_SEARCH_LABEL} again
    </button>
  );
  const suggestions = (
    <>
      <SuggestionCard suggestions={SEARCH_SUGGESTIONS} onPick={pickSuggestion} />
      <CameraPromptCard />
    </>
  );

  return (
    <AppShell variant="stitch" hideNav header={<ScreenHeader title="Search" onBack={goBack} />}>
      <div className="pt-5">
        <SearchField
          value={query}
          onChange={setQuery}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submitSearch(query);
          }}
        />
      </div>

      <section className="mt-6" aria-live="polite">
        {result ? (
          <Link
            to={
              result.verse === undefined
                ? "/chapter/$translation/$book/$chapter"
                : "/verse/$translation/$book/$chapter/$verse"
            }
            params={
              result.verse === undefined
                ? { translation, book: result.bookId, chapter: String(result.chapter) }
                : {
                    translation,
                    book: result.bookId,
                    chapter: String(result.chapter),
                    verse: String(result.verse),
                  }
            }
            className="block border-y border-vs-border/70 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold tracking-tight text-vs-text">
                {result.bookName} {result.chapter}
                {result.verse === undefined ? "" : `:${result.verse}`}
              </span>
              <span className="text-[11px] font-medium text-vs-text-secondary">{translation}</span>
            </span>
          </Link>
        ) : view.kind === "initial" ? (
          <>
            {trimmed.length > 2 ? (
              <p className="mb-5 text-sm text-vs-text-secondary">
                Press Enter to search for a verse like this, or enter a reference such as John 3:16.
              </p>
            ) : null}
            {suggestions}
          </>
        ) : view.kind === "hint" ? (
          <>
            <p className="mb-5 text-sm text-vs-text-secondary">{view.message}</p>
            {suggestions}
          </>
        ) : view.kind === "unindexed" ? (
          <>
            <StateMessage
              illustration={<PreparingIllustration />}
              title={FREE_SEARCH_PREPARING_MESSAGE.replace(/\.$/, "")}
              action={freeActions}
            >
              {SMART_SEARCH_OFFERED
                ? "You can still open a verse by reference. Smart Search uses AI, is limited, and only runs when you ask."
                : "You can still open a verse by reference."}
            </StateMessage>
            {suggestions}
          </>
        ) : view.kind === "free_loading" ? (
          <LoadingState />
        ) : view.kind === "free_results" ? (
          <>
            {queryNote}
            <SearchResultsList
              items={freeResults}
              shown={shown}
              onShowMore={showMoreFree}
              summary={resultSummary(
                Math.min(shown, freeResults.length),
                freeTotal,
                Boolean(lastFreePage?.limitReached) && shown >= freeResults.length,
              )}
              canLoadMore={Boolean(freeSearch.hasNextPage)}
              loadingMore={freeSearch.isFetchingNextPage}
              moreError={freeSearch.isFetchNextPageError}
              onRetryMore={() => void freeSearch.fetchNextPage()}
            />
            {freeNotice ? <UnindexedNotice message={freeNotice} /> : null}
          </>
        ) : view.kind === "free_no_results" ? (
          <>
            {queryNote}
            <StateMessage
              illustration={<NoResultsIllustration />}
              title="No verses found"
              action={freeActions}
            >
              {freeSearched
                ? `We couldn't find any verses matching your search in ${freeSearched}. Try checking your spelling or searching for broader keywords.`
                : "We couldn't find any verses matching your search. Try checking your spelling or searching for broader keywords."}
            </StateMessage>
            {freeNotice ? <UnindexedNotice message={freeNotice} /> : null}
            {suggestions}
          </>
        ) : view.kind === "free_error" ? (
          <StateMessage
            illustration={<ErrorIllustration />}
            title={view.reason === "network" ? "Connection problem" : "Search didn't finish"}
            titleClassName={ERROR_TITLE_CLASS}
            action={freeActions}
          >
            {view.reason === "network"
              ? "We couldn't reach the Bible service. Please check your internet connection and try again."
              : view.reason === "limit"
                ? "You've searched a lot in a short time. Please wait a moment and try again."
                : view.reason === "timeout"
                  ? "That search took too long. Please try again."
                  : "Something went wrong while searching. Please try again."}
          </StateMessage>
        ) : view.kind === "loading" ? (
          <LoadingState />
        ) : view.kind === "results" ? (
          <SearchResultsList
            items={results}
            shown={shown}
            onShowMore={() => setShown((n) => n + FREE_SEARCH_PAGE_SIZE)}
          />
        ) : view.kind === "no_results" ? (
          <>
            <StateMessage
              illustration={<NoResultsIllustration />}
              title="No verses found"
              action={retrySmartSearch}
            >
              We couldn't find any Scriptures matching your search. Try checking your spelling or
              searching for broader keywords.
            </StateMessage>
            {suggestions}
          </>
        ) : view.kind === "network_error" ? (
          <StateMessage
            illustration={<ErrorIllustration />}
            title="Connection problem"
            titleClassName={ERROR_TITLE_CLASS}
            action={retrySmartSearch}
          >
            We couldn't reach the Bible service. Please check your internet connection and try
            again.
          </StateMessage>
        ) : view.kind === "smart_unavailable" ? (
          <>
            <StateMessage
              illustration={<PreparingIllustration />}
              title="Smart Search isn't available right now"
            >
              {FREE_SEARCH_PREPARING_MESSAGE} You can still search by reference.
            </StateMessage>
            {suggestions}
          </>
        ) : view.kind === "smart_limit" ? (
          <StateMessage illustration={<PreparingIllustration />} title="Smart Search limit reached">
            {view.message}
          </StateMessage>
        ) : view.kind === "smart_failed" ? (
          <StateMessage
            illustration={<ErrorIllustration />}
            title="Couldn't complete that search"
            titleClassName={ERROR_TITLE_CLASS}
            action={retrySmartSearch}
          >
            {view.message}
          </StateMessage>
        ) : null}
      </section>
    </AppShell>
  );
}
