import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { VerseRow } from "@/components/verse-row";
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
import { library, type LibraryEntry } from "@/lib/library";

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

function groupByDay(entries: LibraryEntry[]) {
  const groups: { label: string; entries: LibraryEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

function HistoryPage() {
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

  const groups = groupByDay(data ?? []);

  return (
    <AppShell
      title="History"
      action={
        data && data.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger className="text-[0.8125rem] text-muted-foreground hover:text-foreground">
              Clear
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-[22rem] rounded-lg">
              <AlertDialogHeader className="text-left">
                <AlertDialogTitle className="font-serif text-lg">Clear history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes every verse from your history. Saved verses are not affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => clear.mutate()}>Clear history</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null
      }
    >
      {loading || isLoading ? (
        <p className="text-[0.9375rem] text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="border-t border-border pt-8">
          <p className="text-[0.9375rem] font-medium">Nothing here yet.</p>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            Verses you open will appear here.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="mt-6 first:mt-0">
            <h2 className="border-b border-border pb-2 text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              {group.label}
            </h2>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <VerseRow
                    translation={entry.translation}
                    bookId={entry.bookId}
                    bookName={entry.bookName}
                    chapter={entry.chapter}
                    verse={entry.verse}
                    preview={entry.verseText}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </AppShell>
  );
}
