import { Link } from "@tanstack/react-router";
import { PILL_OUTLINE, ResultRowContent } from "@/components/search-states";
import {
  pageOfResults,
  resultKey,
  resultRouteParams,
  verseKey,
  type FreeSearchHit,
} from "@/lib/bible/free-search";

/** A result row; `editions` is present when the same verse was found in several editions. */
type ResultItem = FreeSearchHit & { editions?: readonly string[] };

/** Says which editions full-text search does not cover yet; never worded as "no results". */
export function UnindexedNotice({ message }: { message: string }) {
  return (
    <p role="note" className="mx-auto mt-4 max-w-xs text-center text-xs text-vs-text-secondary">
      {message}
    </p>
  );
}

const LINK_BUTTON =
  "font-semibold text-vs-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * "Showing results for shepherd. Search instead for sheperd": the search was run with a typo repaired,
 * and the person can search the words exactly as they typed them.
 */
export function CorrectedQueryNote({
  corrected,
  original,
  onUseOriginal,
}: {
  corrected: string;
  original: string;
  onUseOriginal: () => void;
}) {
  return (
    <div className="mb-4 space-y-1 text-sm text-vs-text-secondary">
      <p>
        Showing results for <span className="font-semibold text-vs-text">{corrected}</span>
      </p>
      <p>
        Search instead for{" "}
        <button type="button" className={LINK_BUTTON} onClick={onUseOriginal}>
          {original}
        </button>
      </p>
    </div>
  );
}

/** The person chose their own wording: say so, and offer the corrected spelling back. */
export function ExactQueryNote({
  original,
  corrected,
  onUseCorrected,
}: {
  original: string;
  corrected: string | null;
  onUseCorrected: () => void;
}) {
  return (
    <div className="mb-4 space-y-1 text-sm text-vs-text-secondary">
      <p>
        Showing results for <span className="font-semibold text-vs-text">{original}</span>
      </p>
      {corrected ? (
        <p>
          Use the corrected spelling instead:{" "}
          <button type="button" className={LINK_BUTTON} onClick={onUseCorrected}>
            {corrected}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Result rows. Only the first `shown` are rendered, however many came back, so a large result set
 * stays light on a phone. Each row opens the verse in the edition where the match was found.
 *
 * `canLoadMore` means the server has more rows than are loaded; the button then asks for the next page
 * (`loadingMore` while it runs, `moreError` with a retry when it failed). `summary` is the
 * "Showing N of total" line.
 */
export function SearchResultsList({
  items,
  shown,
  onShowMore,
  summary,
  canLoadMore = false,
  loadingMore = false,
  moreError = false,
  onRetryMore,
}: {
  items: readonly ResultItem[];
  shown: number;
  onShowMore: () => void;
  summary?: string | undefined;
  canLoadMore?: boolean;
  loadingMore?: boolean;
  moreError?: boolean;
  onRetryMore?: (() => void) | undefined;
}) {
  const visible = pageOfResults(items, shown);
  const hasMore = visible.length < items.length || canLoadMore;
  return (
    <>
      <h2 className="sr-only">Relevant verses</h2>
      <ul className="divide-y divide-vs-border/70">
        {visible.map((item) => (
          <li key={item.editions ? verseKey(item) : resultKey(item)}>
            <Link
              to="/verse/$translation/$book/$chapter/$verse"
              params={resultRouteParams(item)}
              className="block py-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ResultRowContent
                reference={item.reference}
                translation={item.translation}
                text={item.text}
                alsoIn={item.editions?.slice(1) ?? []}
              />
            </Link>
          </li>
        ))}
      </ul>
      {summary ? (
        <p aria-live="polite" className="mt-4 text-center text-xs text-vs-text-secondary">
          {summary}
        </p>
      ) : null}
      {moreError ? (
        <div role="alert" className="mt-3 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-vs-text-secondary">We couldn&rsquo;t load more verses.</p>
          <button type="button" className={PILL_OUTLINE} onClick={onRetryMore}>
            Try again
          </button>
        </div>
      ) : hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            className={PILL_OUTLINE}
            onClick={onShowMore}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading…" : "Show more verses"}
          </button>
        </div>
      ) : null}
    </>
  );
}
