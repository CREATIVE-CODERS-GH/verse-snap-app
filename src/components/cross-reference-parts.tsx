import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SheetFrame } from "@/components/chapter-sheets";
import { ArrowRightIcon } from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import {
  CROSS_REF_ATTRIBUTION,
  passageLabel,
  testamentOf,
  type CrossPassage,
} from "@/lib/bible/cross-references";
import { cn } from "@/lib/utils";

/*
 * Pieces shared by the places that show Scripture cross-references: the credit line the CC BY 4.0
 * licence asks for, and the bottom sheet opened from the single-verse Reader.
 */

const LINK =
  "underline underline-offset-2 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus rounded-sm";

/** Source, licence link and the note that the data was changed. */
export function CrossRefAttribution({ className }: { className?: string }) {
  const credit = CROSS_REF_ATTRIBUTION;
  return (
    <p className={cn("text-[11.5px] leading-relaxed text-brand-text-muted", className)}>
      Cross-references from{" "}
      <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
        {credit.source}
      </a>
      , based on {credit.basedOn}, licensed{" "}
      <a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
        {credit.licence}
      </a>
      . {credit.changes}
    </p>
  );
}

function PassageRow({
  passage,
  translation,
  onOpen,
}: {
  passage: CrossPassage;
  translation: string;
  onOpen: () => void;
}) {
  const label = passageLabel(passage);
  const { data, isLoading } = useQuery({
    // The same key as the explorer and the reader, so a verse already read is not fetched again.
    queryKey: ["verse", translation, passage.book, String(passage.chapter), String(passage.from)],
    queryFn: () =>
      bibleService.getVerse(
        {
          bookId: passage.book,
          bookName: passage.bookName,
          chapter: passage.chapter,
          verse: passage.from,
        },
        translation,
      ),
    retry: 1,
    staleTime: 5 * 60_000,
  });
  return (
    <li>
      <Link
        to="/verse/$translation/$book/$chapter/$verse"
        params={{
          translation,
          book: passage.book,
          chapter: String(passage.chapter),
          verse: String(passage.from),
        }}
        onClick={onOpen}
        className="group flex min-h-11 items-start justify-between gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-brand-text group-hover:text-brand-primary">
              {label}
            </span>
            <span className="rounded-full bg-brand-surface-muted px-2 py-0.5 text-[10.5px] font-semibold text-brand-gold-text">
              {testamentOf(passage.book)}
            </span>
          </span>
          {data ? (
            <span className="mt-1 line-clamp-2 block font-display text-[14.5px] leading-relaxed text-brand-text-muted">
              “{data.text}”{passage.to !== passage.from ? " …" : ""}
            </span>
          ) : isLoading ? (
            <span
              className="mt-1 block h-3 w-3/4 animate-pulse rounded bg-brand-surface-strong"
              aria-hidden
            />
          ) : null}
        </span>
        <ArrowRightIcon
          className="mt-1 h-4 w-4 shrink-0 text-brand-text-faint group-hover:text-brand-primary"
          aria-hidden
        />
      </Link>
    </li>
  );
}

/**
 * Related passages for a verse, best first. Opening one goes to that verse; Back returns to the
 * reading position the sheet was opened from.
 */
export function CrossReferenceSheet({
  open,
  onOpenChange,
  anchor,
  translation,
  passages,
  total,
  loading,
  failed,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: { bookId: string; chapter: number; verse: number; label: string };
  translation: string;
  /** The passages to list (already limited). */
  passages: readonly CrossPassage[];
  /** How many related passages there are in all. */
  total: number;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const description = loading
    ? anchor.label
    : failed || total === 0
      ? anchor.label
      : `${anchor.label} · top ${passages.length} of ${total}`;
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Related passages"
      description={description}
    >
      <div className="pb-2">
        {loading ? (
          <ul aria-label="Loading related passages" className="divide-y divide-brand-border">
            {[0, 1, 2].map((item) => (
              <li key={item} className="space-y-2 py-4" aria-hidden>
                <span className="block h-4 w-32 animate-pulse rounded bg-brand-surface-strong" />
                <span className="block h-3 w-full animate-pulse rounded bg-brand-surface-muted" />
              </li>
            ))}
          </ul>
        ) : failed ? (
          <div className="py-8 text-center" role="status">
            <p className="text-[15px] text-brand-text-muted">
              Couldn’t load related passages. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-full border border-brand-border px-5 py-2.5 text-[14px] font-semibold text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
            >
              Try again
            </button>
          </div>
        ) : passages.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-brand-text-muted" role="status">
            No cross-references for this verse.
          </p>
        ) : (
          <ul aria-label="Related passages" className="divide-y divide-brand-border">
            {passages.map((passage) => (
              <PassageRow
                key={`${passage.book}:${passage.chapter}:${passage.from}-${passage.to}`}
                passage={passage}
                translation={translation}
                onOpen={() => onOpenChange(false)}
              />
            ))}
          </ul>
        )}
        {!loading && !failed && total > 0 ? (
          <Link
            to="/references/$translation/$book/$chapter/$verse"
            params={{
              translation,
              book: anchor.bookId,
              chapter: String(anchor.chapter),
              verse: String(anchor.verse),
            }}
            onClick={() => onOpenChange(false)}
            className="mt-2 flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand-primary px-4 text-[14px] font-semibold text-brand-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            See all in the Explorer
            <ArrowRightIcon className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        <CrossRefAttribution className="mt-3 text-center" />
      </div>
    </SheetFrame>
  );
}
