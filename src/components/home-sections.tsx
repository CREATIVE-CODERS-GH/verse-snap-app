import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { VerseRow } from "@/components/verse-row";
import { useAuth } from "@/lib/auth";
import { findBook } from "@/lib/bible/books";
import { getStoredLastRead, type LastRead } from "@/lib/last-read";
import { library } from "@/lib/library";

/*
 * "Continue reading" and "Recent" were on the previous Home page. The approved Stitch Home design
 * does not include them, so Home no longer renders them. They are kept here, unchanged in behaviour,
 * until the approved designs for History and Reading say where they belong:
 *   - Continue reading: the Read tab already opens the last-read chapter (see bottom-nav.tsx).
 *   - Recent: the History screen already lists opened verses (src/routes/history.tsx).
 */

export function ContinueReadingCard() {
  const [continueReading, setContinueReading] = useState<LastRead | null>(null);
  useEffect(() => setContinueReading(getStoredLastRead()), []);
  if (!continueReading) return null;
  return (
    <section className="mt-8" aria-label="Continue reading">
      <Link
        to="/chapter/$translation/$book/$chapter"
        params={{
          translation: continueReading.translation,
          book: continueReading.bookId,
          chapter: String(continueReading.chapter),
        }}
        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Continue reading
          </span>
          <span className="mt-1 block truncate font-serif text-base font-semibold">
            {findBook(continueReading.bookId)?.name ?? continueReading.bookId}{" "}
            {continueReading.chapter} · {continueReading.translation}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  );
}

export function RecentVerses() {
  const { user } = useAuth();
  const { data: recent } = useQuery({
    queryKey: ["history", "recent", user?.id],
    queryFn: () => library.listHistory(4, user?.id),
  });
  const items = recent ?? [];
  return (
    <section className="mt-10 pb-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border pb-2">
        <h2 className="truncate text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          Recent
        </h2>
        <Link to="/history" className="shrink-0 text-[0.8125rem] text-primary hover:underline">
          See all
        </Link>
      </div>
      <div>
        {items.map((item) => (
          <VerseRow
            key={`${item.bookId}-${item.chapter}-${item.verse}`}
            translation={item.translation}
            bookId={item.bookId}
            bookName={item.bookName}
            chapter={item.chapter}
            verse={item.verse}
          />
        ))}
      </div>
      {items.length === 0 ? (
        <p className="pt-3 text-[0.8125rem] text-muted-foreground">
          Verses you open will appear here.
        </p>
      ) : null}
    </section>
  );
}
