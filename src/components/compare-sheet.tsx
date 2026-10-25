import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SheetFrame } from "@/components/chapter-sheets";
import { ArrowRightIcon } from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import type { VerseRef } from "@/lib/bible/types";

export interface CompareEdition {
  code: string;
  name: string;
}

function CompareRow({
  edition,
  reference,
  current,
}: {
  edition: CompareEdition;
  reference: VerseRef;
  current: boolean;
}) {
  const query = useQuery({
    // Same key as the single-verse page, so a verse fetched there is reused here.
    queryKey: [
      "verse",
      edition.code,
      reference.bookId,
      String(reference.chapter),
      String(reference.verse),
    ],
    queryFn: () => bibleService.getVerse(reference, edition.code),
    retry: 1,
  });
  return (
    <li className="py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold text-ch-on-surface">{edition.code}</span>
        <span className="truncate text-[11px] text-ch-on-surface-variant">{edition.name}</span>
        {current ? (
          <span className="ml-auto rounded-full bg-ch-container px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ch-primary">
            Reading
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-display text-base leading-relaxed text-ch-on-surface">
        {query.isLoading ? (
          <span className="text-ch-outline">Finding verse…</span>
        ) : query.data ? (
          query.data.text
        ) : (
          <span className="text-ch-on-surface-variant">
            {query.isError
              ? "Couldn’t load this edition right now."
              : "This verse isn’t in this edition."}
          </span>
        )}
      </p>
    </li>
  );
}

/** Shows the selected verse in every edition of the app's catalogue, one under another. */
export function CompareSheet({
  open,
  onOpenChange,
  reference,
  editions,
  currentCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: VerseRef;
  editions: readonly CompareEdition[];
  currentCode: string;
}) {
  const ordered = [
    ...editions.filter((edition) => edition.code === currentCode),
    ...editions.filter((edition) => edition.code !== currentCode),
  ];
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Compare translations"
      description={`${reference.bookName} ${reference.chapter}:${reference.verse}`}
    >
      {open ? (
        <ul className="divide-y divide-ch-container-high pb-2">
          {ordered.map((edition) => (
            <CompareRow
              key={edition.code}
              edition={edition}
              reference={reference}
              current={edition.code === currentCode}
            />
          ))}
        </ul>
      ) : null}
      {open ? (
        <Link
          to="/compare/$translation/$book/$chapter/$verse"
          params={{
            translation: currentCode,
            book: reference.bookId,
            chapter: String(reference.chapter),
            verse: String(reference.verse),
          }}
          className="mb-2 mt-1 flex items-center justify-center gap-1.5 rounded-full border border-brand-border py-3 text-[14px] font-semibold text-brand-primary transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          Open full comparison <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </SheetFrame>
  );
}
