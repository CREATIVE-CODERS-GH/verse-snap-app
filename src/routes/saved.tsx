import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { VerseRow } from "@/components/verse-row";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved Verses — Verse Snap" },
      { name: "description", content: "The Bible verses you have saved to come back to." },
      { property: "og:title", content: "Saved Verses — Verse Snap" },
      { property: "og:description", content: "The Bible verses you have saved to come back to." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SavedPage,
});

function SavedPage() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["saved", user?.id],
    queryFn: () => library.listSaved(user?.id),
    enabled: !loading,
  });

  const remove = useMutation({
    mutationFn: (id: string) => library.removeSaved(id, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast("Removed from saved");
    },
    onError: () => toast("Could not remove that verse"),
  });

  return (
    <AppShell title="Saved Verses">
      {loading || isLoading ? (
        <p className="text-[0.9375rem] text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <div className="border-t border-border pt-8">
          <p className="text-[0.9375rem] font-medium">No saved verses yet.</p>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            Save verses you want to come back to.
          </p>
        </div>
      ) : (
        <ul className="border-t border-border">
          {data.map((entry) => (
            <li key={entry.id}>
              <VerseRow
                translation={entry.translation}
                bookId={entry.bookId}
                bookName={entry.bookName}
                chapter={entry.chapter}
                verse={entry.verse}
                preview={entry.verseText}
                trailing={
                  <button
                    type="button"
                    aria-label={`Remove ${entry.bookName} ${entry.chapter}:${entry.verse}`}
                    onClick={() => remove.mutate(entry.id)}
                    className="p-2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
