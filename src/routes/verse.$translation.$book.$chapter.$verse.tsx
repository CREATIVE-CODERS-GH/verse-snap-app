import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Copy, Share2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ComingSoonDialog } from "@/components/coming-soon-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findBook } from "@/lib/bible/books";
import { bibleService } from "@/lib/bible/service";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";

export const Route = createFileRoute("/verse/$translation/$book/$chapter/$verse")({
  head: ({ params }) => {
    const book = findBook(params.book);
    const reference = `${book?.name ?? params.book} ${params.chapter}:${params.verse}`;
    return {
      meta: [
        { title: `${reference} (${params.translation}) — Verse Snap` },
        { name: "description", content: `Read ${reference} in the ${params.translation} on Verse Snap.` },
        { property: "og:title", content: `${reference} — Verse Snap` },
        { property: "og:description", content: `Read ${reference} in the ${params.translation}.` },
      ],
    };
  },
  component: VersePage,
});

function VersePage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [listenOpen, setListenOpen] = useState(false);
  const recorded = useRef<string | null>(null);

  const ref = {
    bookId: params.book,
    bookName: findBook(params.book)?.name ?? params.book,
    chapter: Number(params.chapter),
    verse: Number(params.verse),
  };

  const { data: verse, isLoading } = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(ref, params.translation),
  });

  const { data: neighbours } = useQuery({
    queryKey: ["verse-neighbours", params.translation, params.book, params.chapter, params.verse],
    queryFn: async () => ({
      previous: await bibleService.getNeighbour(ref, -1, params.translation),
      next: await bibleService.getNeighbour(ref, 1, params.translation),
    }),
  });

  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });

  const { data: saved } = useQuery({
    queryKey: ["saved", "is", user?.id, params.translation, params.book, params.chapter, params.verse],
    queryFn: () => library.isSaved(ref, params.translation),
    enabled: Boolean(user),
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!user || !verse) return;
      if (saved) await library.unsave(ref, params.translation);
      else await library.save(verse, user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(saved ? "Removed from saved" : "Saved");
    },
    onError: () => toast("Could not update saved verses"),
  });

  // Record the view once per verse, for signed-in readers only.
  useEffect(() => {
    const key = `${params.translation}/${params.book}/${params.chapter}/${params.verse}`;
    if (!user || !verse || recorded.current === key) return;
    recorded.current = key;
    library
      .recordView(verse, user.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["history"] }))
      .catch(() => undefined);
  }, [user, verse, params, queryClient]);

  async function handleCopy() {
    if (!verse) return;
    await navigator.clipboard.writeText(`“${verse.text}” — ${verse.reference} (${verse.translation})`);
    toast("Copied");
  }

  async function handleShare() {
    if (!verse) return;
    const text = `“${verse.text}” — ${verse.reference} (${verse.translation})`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: verse.reference, text });
        return;
      } catch {
        return;
      }
    }
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  }

  const actionClass =
    "flex flex-1 flex-col items-center gap-1.5 py-2 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground";

  return (
    <AppShell>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-7">
        <Link
          to="/search"
          className="flex min-w-0 items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          Search
        </Link>
        <Select
          value={params.translation}
          onValueChange={(value) =>
            navigate({
              to: "/verse/$translation/$book/$chapter/$verse",
              params: { ...params, translation: value },
            })
          }
        >
          <SelectTrigger className="h-8 w-auto gap-1.5 border-border text-[0.8125rem]" aria-label="Translation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(translations ?? [{ code: params.translation, name: params.translation, language: "" }]).map(
              (item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.code}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <article className="mt-8">
        <h1 className="font-serif text-xl font-semibold tracking-tight">
          {ref.bookName} {ref.chapter}:{ref.verse}
        </h1>
        {isLoading ? (
          <p className="mt-5 text-[0.9375rem] text-muted-foreground">Loading…</p>
        ) : verse ? (
          <p className="scripture mt-5">{verse.text}</p>
        ) : (
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
            This verse is not in the sample text yet. The full Bible arrives when the Bible service is
            connected — try John 3:16, Romans 8:28, Hebrews 2:5 or Psalm 23:1.
          </p>
        )}
      </article>

      <div className="mt-8 flex border-y border-border">
        <button type="button" className={actionClass} onClick={() => setListenOpen(true)}>
          <Volume2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          Listen
        </button>
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            if (!user) {
              navigate({ to: "/auth" });
              return;
            }
            toggleSave.mutate();
          }}
          disabled={!verse}
        >
          {saved ? (
            <BookmarkCheck className="h-[1.125rem] w-[1.125rem] text-primary" strokeWidth={1.75} aria-hidden />
          ) : (
            <Bookmark className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          )}
          {saved ? "Saved" : "Save"}
        </button>
        <button type="button" className={actionClass} onClick={handleCopy} disabled={!verse}>
          <Copy className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          Copy
        </button>
        <button type="button" className={actionClass} onClick={handleShare} disabled={!verse}>
          <Share2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          Share
        </button>
      </div>

      <nav className="mt-6 flex items-center justify-between text-[0.875rem]">
        {neighbours?.previous ? (
          <Link
            to="/verse/$translation/$book/$chapter/$verse"
            params={{
              translation: params.translation,
              book: neighbours.previous.bookId,
              chapter: String(neighbours.previous.chapter),
              verse: String(neighbours.previous.verse),
            }}
            className="flex items-center gap-1 text-primary"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground/60">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </span>
        )}
        {neighbours?.next ? (
          <Link
            to="/verse/$translation/$book/$chapter/$verse"
            params={{
              translation: params.translation,
              book: neighbours.next.bookId,
              chapter: String(neighbours.next.chapter),
              verse: String(neighbours.next.verse),
            }}
            className="flex items-center gap-1 text-primary"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground/60">
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </nav>

      <ComingSoonDialog
        open={listenOpen}
        onOpenChange={setListenOpen}
        title="Listening is coming soon"
        description="Spoken verses arrive alongside the audio settings. Reading, saving and sharing work today."
      />
    </AppShell>
  );
}
