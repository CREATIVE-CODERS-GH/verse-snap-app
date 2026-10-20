import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ChevronRightIcon, ClockIcon } from "@/components/stitch-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { library, type HistoryEntry } from "@/lib/library";
import { trackEvent } from "@/lib/analytics";

/*
 * History — Stitch "10 History": verses opened recently, grouped by day with the time each was
 * opened. Uses the same history library as before (account when signed in, this device otherwise).
 */

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Verse Snap" },
      { name: "description", content: "Bible verses you have opened recently, grouped by day." },
      { property: "og:title", content: "History — Verse Snap" },
      { property: "og:description", content: "Bible verses you have opened recently." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function groupByDay(entries: HistoryEntry[]) {
  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

const ROW_CLASS =
  "group flex items-center justify-between py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus";

/** One History row: clock, reference (a verse, or a whole chapter), time and chevron. */
function HistoryRowContent({
  label,
  detail,
  entry,
}: {
  label: string;
  detail?: string;
  entry: HistoryEntry;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-3.5">
        <ClockIcon className="h-5 w-5 shrink-0 text-brand-text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold leading-snug text-brand-text transition-colors group-hover:text-brand-primary">
            {label}
          </span>
          <span className="mt-0.5 block text-xs text-brand-text-muted">
            {detail ? `${detail} · ` : ""}
            {timeLabel(entry.at)}
            <span className="sr-only">, {entry.translation}</span>
          </span>
        </span>
      </span>
      <ChevronRightIcon
        className="h-5 w-5 shrink-0 text-brand-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-brand-text-muted"
        aria-hidden
      />
    </>
  );
}

function HistoryPage() {
  useEffect(() => {
    trackEvent("history_opened");
  }, []);
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["history", user?.id],
    queryFn: () => library.listHistory(100, user?.id),
    enabled: !loading,
  });

  const clear = useMutation({
    mutationFn: () => library.clearHistory(user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
      toast("History cleared");
    },
    onError: () => toast("Could not clear history"),
  });

  const busy = loading || isLoading;
  const groups = groupByDay(data ?? []);

  if (!busy && groups.length === 0) {
    return (
      <AppShell variant="stitch">
        <main className="flex flex-1 flex-col items-center justify-center px-2 pb-10 text-center">
          <h1 className="sr-only">History</h1>
          <ClockIcon className="mb-6 h-14 w-14 text-brand-text" strokeWidth={1.6} aria-hidden />
          <h2 className="font-display text-[26px] font-bold leading-tight tracking-tight text-brand-text">
            No recent verses
          </h2>
          <p className="mt-3 max-w-[290px] text-[15px] leading-relaxed text-brand-text-muted">
            Verses you open will appear here, so you can find your way back to them.
          </p>
          <Link
            to="/search"
            className="mt-8 rounded-full bg-brand-primary px-10 py-3.5 text-[15px] font-semibold text-brand-on-primary shadow-md transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas"
          >
            Find a Verse
          </Link>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell variant="stitch">
      <main className="flex flex-1 flex-col">
        <header className="flex items-baseline justify-between pb-2 pt-6">
          <h1 className="text-3xl font-bold tracking-tight text-brand-text">History</h1>
          {data && data.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger className="rounded-md px-1 text-sm font-medium text-brand-text-muted transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus">
                Clear
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-[22rem] rounded-2xl border-brand-border bg-brand-surface font-stitch text-brand-text">
                <AlertDialogHeader className="text-left">
                  <AlertDialogTitle className="font-display text-lg">
                    Clear history?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-brand-text-muted">
                    This removes every verse from your history. Saved verses are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clear.mutate()}
                    className="rounded-full bg-brand-danger text-brand-on-danger hover:bg-brand-danger/90"
                  >
                    Clear history
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </header>

        {busy ? (
          <ul aria-label="Loading history" className="mt-4 divide-y divide-brand-border">
            {[0, 1, 2, 3, 4].map((item) => (
              <li key={item} className="flex items-center gap-3.5 py-3.5" aria-hidden>
                <span className="h-5 w-5 animate-pulse rounded-full bg-brand-surface-strong" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-4 w-32 animate-pulse rounded bg-brand-surface-strong" />
                  <span className="block h-3 w-16 animate-pulse rounded bg-brand-surface-muted" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          groups.map((group) => (
            <section
              key={group.label}
              className="mt-4 first-of-type:mt-3 last:mb-0"
              aria-label={group.label}
            >
              <h2 className="mb-3 text-[13px] font-semibold text-brand-text-muted">
                {group.label}
              </h2>
              <ul className="mb-7 divide-y divide-brand-border">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    {entry.kind === "chapter" ? (
                      <Link
                        to="/chapter/$translation/$book/$chapter"
                        params={{
                          translation: entry.translation,
                          book: entry.bookId,
                          chapter: String(entry.chapter),
                        }}
                        className={ROW_CLASS}
                      >
                        <HistoryRowContent
                          label={`${entry.bookName} ${entry.chapter}`}
                          detail="Chapter"
                          entry={entry}
                        />
                      </Link>
                    ) : (
                      <Link
                        to="/verse/$translation/$book/$chapter/$verse"
                        params={{
                          translation: entry.translation,
                          book: entry.bookId,
                          chapter: String(entry.chapter),
                          verse: String(entry.verse),
                        }}
                        className={ROW_CLASS}
                      >
                        <HistoryRowContent
                          label={`${entry.bookName} ${entry.chapter}:${entry.verse}`}
                          entry={entry}
                        />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </AppShell>
  );
}
