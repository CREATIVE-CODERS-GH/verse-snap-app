import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  ResultRowContent,
  StateMessage,
  SuggestionCard,
} from "@/components/search-states";
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
  FREE_SEARCH_PREPARING_MESSAGE,
  SMART_SEARCH_LABEL,
  startFreeSearch,
} from "@/lib/bible/free-search";
import { decideSubmit } from "@/lib/bible/search-interaction";
import { routeMessage, routeQuery } from "@/lib/bible/search-router";
import { SEARCH_SUGGESTIONS, type SearchSuggestion } from "@/lib/bible/search-suggestions";
import { deriveSearchView } from "@/lib/bible/search-view";
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

  // Free search is what Enter and Search start. While its index is not installed it reports "preparing".
  const freeSearch = useMemo(
    () => (description ? startFreeSearch(description) : null),
    [description],
  );

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
    freeStatus: freeSearch?.status ?? "preparing",
  });

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
              action={
                <button type="button" className={PILL_PRIMARY} onClick={startSmartSearch}>
                  <SparkleIcon className="h-4 w-4" />
                  {SMART_SEARCH_LABEL}
                </button>
              }
            >
              You can still open a verse by reference. Smart Search uses AI, is limited, and only
              runs when you ask.
            </StateMessage>
            {suggestions}
          </>
        ) : view.kind === "loading" ? (
          <LoadingState />
        ) : view.kind === "results" ? (
          <>
            <h2 className="sr-only">Relevant verses</h2>
            <ul className="divide-y divide-vs-border/70">
              {results.map((item) => (
                <li key={`${item.bookId}-${item.chapter}-${item.verse}`}>
                  <Link
                    to="/verse/$translation/$book/$chapter/$verse"
                    params={{
                      translation,
                      book: item.bookId,
                      chapter: String(item.chapter),
                      verse: String(item.verse),
                    }}
                    className="block py-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ResultRowContent
                      reference={item.reference}
                      translation={item.translation}
                      text={item.text}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
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
