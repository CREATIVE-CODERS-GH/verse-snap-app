import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { PublisherNotice } from "@/components/publisher-notice";
import { ScreenHeader } from "@/components/screen-header";
import { SearchField } from "@/components/search-field";
import { SearchModeSwitch } from "@/components/search-mode-switch";
import {
  ERROR_TITLE_CLASS,
  ErrorIllustration,
  LoadingState,
  NoResultsIllustration,
  PILL_OUTLINE,
  PILL_PRIMARY,
  ResultRowContent,
  StateMessage,
} from "@/components/search-states";
import { canExportImage, YOUVERSION_EDITIONS } from "@/lib/bible/translations";
import {
  describeDiscoverError,
  imagesOptions,
  overviewOptions,
  canPreview,
  previewOptions,
  resolveDiscoverTranslation,
  suggestOptions,
  trendingOptions,
  versesInfiniteOptions,
  type DiscoverRunner,
} from "@/lib/bible/youversion-discover";
import { discoverSearch } from "@/lib/bible/youversion-discover.functions";
import { DISCOVER_IMAGES_PER_PAGE } from "@/lib/bible/youversion-discover-protocol";
import type { DiscoverPassage } from "@/lib/bible/youversion-discover-refs";
import { usePreferences } from "@/lib/preferences";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useInView } from "@/lib/use-in-view";

const searchRoute = getRouteApi("/search");

/** Typing waits this long after the last keystroke before asking for suggestions. */
const SUGGEST_DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 8;
/** One letter is too vague to suggest from; waiting for a second saves a request per search. */
const SUGGEST_MIN_CHARS = 2;

const CHIP =
  "inline-flex items-center rounded-full border border-vs-border/70 bg-vs-bg px-3.5 py-2 text-xs font-medium text-vs-text transition-all hover:bg-vs-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** The Search screen in Discover mode: the switch, the translation chips and the YouVersion search. */
export function DiscoverSearchPage() {
  const { q, t } = searchRoute.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const { translation: preferred } = usePreferences();
  const translation = resolveDiscoverTranslation(t, preferred);
  const submitted = q ?? "";

  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else navigate({ to: "/", replace: true });
  };

  return (
    <AppShell variant="stitch" hideNav header={<ScreenHeader title="Search" onBack={goBack} />}>
      <div className="pt-5">
        <SearchModeSwitch mode="discover" />
      </div>
      <DiscoverSearch
        submitted={submitted}
        translation={translation}
        onSubmit={(text) =>
          navigate({
            to: "/search",
            search: { mode: "discover", q: text, t: translation },
            replace: true,
          })
        }
        onTranslation={(code) =>
          navigate({
            to: "/search",
            search: { mode: "discover", ...(submitted ? { q: submitted } : {}), t: code },
            replace: true,
          })
        }
      />
    </AppShell>
  );
}

interface DiscoverSearchProps {
  /** The query the URL holds: the one whose results are shown. */
  submitted: string;
  translation: string;
  onSubmit: (query: string) => void;
  onTranslation: (code: string) => void;
}

export function DiscoverSearch({
  submitted,
  translation,
  onSubmit,
  onTranslation,
}: DiscoverSearchProps) {
  const run = useServerFn(discoverSearch) as unknown as DiscoverRunner;
  const [input, setInput] = useState(submitted);
  useEffect(() => setInput(submitted), [submitted]);
  const trimmed = input.trim();
  const debounced = useDebouncedValue(trimmed, SUGGEST_DEBOUNCE_MS);

  // Three views, decided only by what is typed: nothing (trending), something new (suggestions), or the
  // query whose results are in the URL (results).
  const view = trimmed === "" ? "trending" : trimmed !== submitted ? "suggestions" : "results";

  const submit = (text: string) => {
    const next = text.trim();
    if (!next) return;
    setInput(next);
    onSubmit(next);
  };

  // Trending only loads when the screen is empty; suggestions only while typing, after the pause.
  const trending = useQuery({ ...trendingOptions(run), enabled: view === "trending" });
  const suggestions = useQuery({
    ...suggestOptions(run, debounced),
    enabled: view === "suggestions" && debounced.length >= SUGGEST_MIN_CHARS,
  });

  // Results start only for a submitted query. Verses come page by page; topics and images come from the
  // unified call; a failure of the second never hides the first.
  const verses = useInfiniteQuery({
    ...versesInfiniteOptions(run, translation, submitted),
    enabled: submitted !== "",
  });
  const overview = useQuery({
    ...overviewOptions(run, translation, submitted),
    enabled: submitted !== "",
  });

  const pages = verses.data?.pages ?? [];
  const passages = useMemo(() => {
    const seen = new Set<string>();
    return pages
      .flatMap((page) => page.passages)
      .filter((passage) => !seen.has(passage.id) && seen.add(passage.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pages` is derived from verses.data
  }, [verses.data]);

  // Verse images appear only where the edition's terms allow images (see canExportImage).
  const imagesAllowed = canExportImage(translation);
  const imageIds = imagesAllowed ? (overview.data?.imageIds ?? []) : [];

  const topics = overview.data?.topics ?? [];
  const lowered = submitted.toLowerCase();
  const didYouMean = [
    ...new Set([...(overview.data?.didYouMean ?? []), ...(pages[0]?.didYouMean ?? [])]),
  ].filter((item) => item.toLowerCase() !== lowered);
  const searchInstead = pages[0]?.searchInsteadFor ?? overview.data?.searchInsteadFor ?? null;

  const retryAll = () => {
    void verses.refetch();
    void overview.refetch();
  };
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  // Read here, before the JSX narrows `verses` by its error branch.
  const loadMoreFailed = verses.isFetchNextPageError;
  const loadMore = () => void verses.fetchNextPage();

  return (
    <>
      <div className="mt-4">
        <TranslationChips value={translation} onChange={onTranslation} />
      </div>
      <div className="mt-4">
        <SearchField
          value={input}
          onChange={setInput}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submit(input);
          }}
          placeholder="Search topics, verses, phrases..."
          label="Discover search"
          maxLength={100}
          hiddenFields={{ mode: "discover", t: translation }}
        />
      </div>

      <section className="mt-6" aria-live="polite" data-testid="discover-body">
        {view === "trending" ? (
          <TrendingSection
            state={trending}
            onPick={submit}
            online={online}
            translation={translation}
          />
        ) : view === "suggestions" ? (
          <SuggestionList
            typed={trimmed}
            queries={suggestions.data?.queries ?? []}
            loading={suggestions.isFetching && !suggestions.data}
            onPick={submit}
          />
        ) : verses.isPending ? (
          <LoadingState />
        ) : verses.isError ? (
          <ErrorState
            error={verses.error}
            translation={translation}
            online={online}
            onRetry={retryAll}
          />
        ) : passages.length === 0 && topics.length === 0 && imageIds.length === 0 ? (
          <>
            <DidYouMean items={didYouMean} searchInstead={searchInstead} onPick={submit} />
            <StateMessage
              illustration={<NoResultsIllustration />}
              title="Nothing found"
              action={
                <button type="button" className={PILL_OUTLINE} onClick={() => setInput("")}>
                  See trending searches
                </button>
              }
            >
              {`Discover couldn't find results for "${submitted}" in ${translation}. Try different words or a broader topic.`}
            </StateMessage>
          </>
        ) : (
          <>
            <DidYouMean items={didYouMean} searchInstead={searchInstead} onPick={submit} />
            <TopicsSection topics={topics} onPick={submit} />
            {passages.length > 0 ? (
              <>
                <h2 className="mb-1 text-sm font-semibold text-vs-text">Verses</h2>
                <ul className="divide-y divide-vs-border/70" data-testid="discover-verses">
                  {passages.map((passage, index) => (
                    <DiscoverVerseRow
                      key={passage.id}
                      passage={passage}
                      index={index}
                      translation={translation}
                      run={run}
                    />
                  ))}
                </ul>
                {loadMoreFailed ? (
                  <div role="alert" className="mt-3 flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-vs-text-secondary">
                      We couldn&rsquo;t load more verses.
                    </p>
                    <button type="button" className={PILL_OUTLINE} onClick={loadMore}>
                      Try again
                    </button>
                  </div>
                ) : verses.hasNextPage ? (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      className={PILL_OUTLINE}
                      onClick={loadMore}
                      disabled={verses.isFetchingNextPage}
                      aria-busy={verses.isFetchingNextPage}
                    >
                      {verses.isFetchingNextPage ? "Loading…" : "Load more"}
                    </button>
                  </div>
                ) : null}
                <PublisherNotice translation={translation} />
              </>
            ) : null}
            <ImagesSection
              key={`${submitted}|${translation}`}
              allowed={imagesAllowed}
              translation={translation}
              ids={imageIds}
              run={run}
            />
          </>
        )}
      </section>
      <p className="mt-8 text-center text-[11px] text-vs-text-secondary">
        Discover search is powered by YouVersion.
      </p>
    </>
  );
}

/**
 * One verse result. Its text is requested only once the row is near the screen, and only for the first 25
 * results (the preview cap), so a search never fetches licensed text nobody will see. Anything not
 * previewed, or that could not be fetched, shows the reference and opens the reader.
 */
function DiscoverVerseRow({
  passage,
  index,
  translation,
  run,
}: {
  passage: DiscoverPassage;
  index: number;
  translation: string;
  run: DiscoverRunner;
}) {
  const [ref, near] = useInView<HTMLLIElement>();
  const allowed = canPreview(index);
  const preview = useQuery({
    ...previewOptions(run, translation, passage.id),
    enabled: near && allowed,
  });
  const text = preview.data?.texts[passage.id];
  const fallback = `Open to read this passage in ${translation}.`;
  const shown =
    text ?? (!allowed || preview.isError || preview.isSuccess ? fallback : "Loading passage…");
  return (
    <li ref={ref}>
      <Link
        to="/verse/$translation/$book/$chapter/$verse"
        params={{
          translation,
          book: passage.bookId,
          chapter: String(passage.chapter),
          verse: String(passage.verse),
        }}
        className="block py-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ResultRowContent reference={passage.label} translation={translation} text={shown} />
      </Link>
    </li>
  );
}

function TranslationChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Bible translation" className="flex items-center gap-2">
      {YOUVERSION_EDITIONS.map((edition) => {
        const active = edition.code === value;
        return (
          <button
            key={edition.code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${edition.code}, ${edition.name}`}
            onClick={() => onChange(edition.code)}
            className={`rounded-full px-4 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-vs-primary font-semibold text-vs-on-primary shadow-sm" : "border border-vs-border bg-vs-surface font-medium text-vs-text-secondary hover:text-vs-text"}`}
          >
            {edition.code}
          </button>
        );
      })}
    </div>
  );
}

function TrendingSection({
  state,
  onPick,
  online,
  translation,
}: {
  state: ReturnType<typeof useQuery<{ queries: string[] }>>;
  onPick: (query: string) => void;
  online: boolean;
  translation: string;
}) {
  const queries = state.data?.queries ?? [];
  return (
    <section
      aria-label="Trending searches"
      className="w-full rounded-2xl border border-vs-border/60 bg-vs-surface p-5 shadow-sm"
    >
      <h2 className="mb-3.5 text-sm font-semibold text-vs-text">Trending searches</h2>
      {state.isPending ? (
        <div className="flex flex-wrap gap-2" aria-busy="true" data-testid="trending-loading">
          {[84, 112, 96, 72, 104].map((width) => (
            <span
              key={width}
              style={{ width }}
              className="h-8 animate-pulse rounded-full bg-vs-container"
            />
          ))}
        </div>
      ) : state.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-vs-text-secondary">
            {describeDiscoverError(state.error, { translation, online }).message}
          </p>
          <button type="button" className={PILL_OUTLINE} onClick={() => void state.refetch()}>
            Try again
          </button>
        </div>
      ) : queries.length === 0 ? (
        <p className="text-sm text-vs-text-secondary">
          Trending searches aren&rsquo;t available right now. Type anything to search.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" data-testid="trending-list">
          {queries.map((query) => (
            <li key={query}>
              <button type="button" className={CHIP} onClick={() => onPick(query)}>
                {query}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionList({
  typed,
  queries,
  loading,
  onPick,
}: {
  typed: string;
  queries: readonly string[];
  loading: boolean;
  onPick: (query: string) => void;
}) {
  const lowered = typed.toLowerCase();
  const items = queries
    .filter((query) => query.toLowerCase() !== lowered)
    .slice(0, MAX_SUGGESTIONS);
  return (
    <section aria-label="Suggestions" data-testid="discover-suggestions">
      <ul className="divide-y divide-vs-border/70">
        <li>
          <button
            type="button"
            onClick={() => onPick(typed)}
            className="flex w-full items-center py-3.5 text-left text-[15px] font-semibold text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {`Search for “${typed}”`}
          </button>
        </li>
        {items.map((query) => (
          <li key={query}>
            <button
              type="button"
              onClick={() => onPick(query)}
              className="flex w-full items-center py-3.5 text-left text-[15px] text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {query}
            </button>
          </li>
        ))}
      </ul>
      {loading ? (
        <p className="mt-3 text-xs text-vs-text-secondary" role="status">
          Looking for suggestions…
        </p>
      ) : null}
    </section>
  );
}

function DidYouMean({
  items,
  searchInstead,
  onPick,
}: {
  items: readonly string[];
  searchInstead: string | null;
  onPick: (query: string) => void;
}) {
  if (items.length === 0 && !searchInstead) return null;
  return (
    <p className="mb-5 text-sm text-vs-text-secondary" data-testid="did-you-mean">
      {items.length > 0 ? (
        <>
          Did you mean{" "}
          {items.slice(0, 3).map((item, index) => (
            <span key={item}>
              {index > 0 ? ", " : ""}
              <button
                type="button"
                onClick={() => onPick(item)}
                className="font-semibold text-vs-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item}
              </button>
            </span>
          ))}
          ?
        </>
      ) : null}
      {searchInstead ? (
        <>
          {items.length > 0 ? " " : ""}
          Search instead for{" "}
          <button
            type="button"
            onClick={() => onPick(searchInstead)}
            className="font-semibold text-vs-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {searchInstead}
          </button>
          .
        </>
      ) : null}
    </p>
  );
}

function TopicsSection({
  topics,
  onPick,
}: {
  topics: readonly { text: string; subtopics: string[] }[];
  onPick: (query: string) => void;
}) {
  if (topics.length === 0) return null;
  return (
    <section aria-label="Related topics" className="mb-6" data-testid="discover-topics">
      <h2 className="mb-2.5 text-sm font-semibold text-vs-text">Related topics</h2>
      <div className="flex flex-col gap-3">
        {topics.map((topic) => (
          <div key={topic.text}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onPick(topic.text)}
                className={`${CHIP} border-vs-primary/50 font-semibold`}
              >
                {topic.text}
              </button>
              {topic.subtopics.slice(0, 6).map((subtopic) => (
                <button
                  key={subtopic}
                  type="button"
                  onClick={() => onPick(subtopic)}
                  className={CHIP}
                >
                  {subtopic}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ImagesSection({
  allowed,
  translation,
  ids,
  run,
}: {
  allowed: boolean;
  translation: string;
  ids: readonly string[];
  run: DiscoverRunner;
}) {
  // Image records are fetched only once this section is near the screen, a group at a time.
  const [ref, near] = useInView<HTMLElement>();
  const [count, setCount] = useState(DISCOVER_IMAGES_PER_PAGE);
  const groups = chunk(ids.slice(0, count), DISCOVER_IMAGES_PER_PAGE);
  const results = useQueries({
    queries: groups.map((group) => ({
      ...imagesOptions(run, translation, group),
      enabled: allowed && near,
    })),
  });
  const images = results.flatMap((result) => result.data?.images ?? []);
  const loading = results.some((result) => result.isPending);
  const canShowMore = count < ids.length;
  const onShowMore = () => setCount((value) => value + DISCOVER_IMAGES_PER_PAGE);
  if (!allowed) {
    return (
      <p className="mt-8 text-xs text-vs-text-secondary" data-testid="images-unavailable">
        Verse images aren&rsquo;t shown for {translation}.
      </p>
    );
  }
  if (ids.length === 0 || (near && images.length === 0 && !loading)) return null;
  return (
    <section ref={ref} aria-label="Verse images" className="mt-8" data-testid="discover-images">
      <h2 className="mb-2.5 text-sm font-semibold text-vs-text">Verse images</h2>
      {images.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <span
              key={index}
              style={{ aspectRatio: 9 / 16 }}
              className="animate-pulse rounded-xl bg-vs-container"
            />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-2 md:grid-cols-4">
          {images.map((image) => {
            const picture = (
              <img
                src={`${image.url}?size=thumb`}
                alt={image.passage ? `Verse image for ${image.passage.label}` : "Verse image"}
                loading="lazy"
                decoding="async"
                style={{ aspectRatio: image.aspectRatio }}
                className="w-full rounded-xl bg-vs-container object-cover"
              />
            );
            return (
              <li key={image.id}>
                <figure>
                  {image.passage ? (
                    <Link
                      to="/verse/$translation/$book/$chapter/$verse"
                      params={{
                        translation,
                        book: image.passage.bookId,
                        chapter: String(image.passage.chapter),
                        verse: String(image.passage.verse),
                      }}
                      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {picture}
                    </Link>
                  ) : (
                    picture
                  )}
                  <figcaption className="mt-1 text-[10px] leading-tight text-vs-text-secondary">
                    {image.passage ? `${image.passage.label} · ` : ""}
                    {image.attribution}
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      )}
      {canShowMore ? (
        <div className="mt-4 flex justify-center">
          <button type="button" className={PILL_OUTLINE} onClick={onShowMore}>
            Show more images
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ErrorState({
  error,
  translation,
  online,
  onRetry,
}: {
  error: unknown;
  translation: string;
  online: boolean;
  onRetry: () => void;
}) {
  const described = describeDiscoverError(error, { translation, online });
  return (
    <StateMessage
      illustration={<ErrorIllustration />}
      title={described.title}
      titleClassName={ERROR_TITLE_CLASS}
      action={
        described.kind === "denied" || described.kind === "disabled" ? null : (
          <button type="button" className={PILL_PRIMARY} onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      {described.message}
    </StateMessage>
  );
}
