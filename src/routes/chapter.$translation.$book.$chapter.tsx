import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { setLastRead } from "@/lib/last-read";
import { BIBLE_BOOKS, findBook } from "@/lib/bible/books";
import { BibleServiceError } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { translationName } from "@/lib/bible/translations";

export const Route = createFileRoute("/chapter/$translation/$book/$chapter")({
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}`;
    return {
      meta: [
        { title: `${reference} (${params.translation}) — Verse Snap` },
        { name: "description", content: `Read ${reference} on Verse Snap.` },
        { property: "og:title", content: `${reference} — Verse Snap` },
        { property: "og:description", content: `Read the full chapter of ${reference}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: ChapterPage,
});

function ChapterPage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const book = findBook(params.book);
  const chapterNumber = Number(params.chapter);
  const ref = { bookId: params.book, bookName: book?.name ?? params.book, chapter: chapterNumber };
  const query = useQuery({
    queryKey: ["chapter", params.translation, params.book, params.chapter],
    queryFn: () => bibleService.getChapter(ref, params.translation),
    enabled: Boolean(book && Number.isInteger(chapterNumber) && chapterNumber > 0),
  });

  useEffect(() => {
    if (query.data) {
      setLastRead({ translation: params.translation, bookId: params.book, chapter: chapterNumber });
    }
  }, [query.data, params.translation, params.book, chapterNumber]);

  // Chapter-level neighbours, crossing book boundaries at the edges.
  const bookIndex = BIBLE_BOOKS.findIndex((item) => item.id === book?.id);
  const previous =
    book && chapterNumber > 1
      ? { bookId: book.id, chapter: chapterNumber - 1, label: `${book.name} ${chapterNumber - 1}` }
      : bookIndex > 0
        ? {
            bookId: BIBLE_BOOKS[bookIndex - 1].id,
            chapter: BIBLE_BOOKS[bookIndex - 1].chapters,
            label: `${BIBLE_BOOKS[bookIndex - 1].name} ${BIBLE_BOOKS[bookIndex - 1].chapters}`,
          }
        : null;
  const next =
    book && chapterNumber < book.chapters
      ? { bookId: book.id, chapter: chapterNumber + 1, label: `${book.name} ${chapterNumber + 1}` }
      : bookIndex >= 0 && bookIndex < BIBLE_BOOKS.length - 1
        ? { bookId: BIBLE_BOOKS[bookIndex + 1].id, chapter: 1, label: `${BIBLE_BOOKS[bookIndex + 1].name} 1` }
        : null;

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const message =
    query.error instanceof BibleServiceError && query.error.kind === "network"
      ? offline
        ? "You’re offline, and this chapter isn’t saved on this device yet. Chapters you’ve opened recently are available offline — reconnect to read this one."
        : "Verse Snap couldn’t reach the Bible. Check your connection and try again."
      : "That Bible reference doesn't look right.";

  return (
    <AppShell>
      <div className="pt-7">
        <Link
          to="/search"
          className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Search
        </Link>
      </div>
      <article className="mt-8">
        <h1 className="font-serif text-2xl font-semibold">
          {ref.bookName} {chapterNumber}
        </h1>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {query.data?.translation ?? params.translation} ·{" "}
          {translationName(query.data?.translation ?? params.translation)}
        </p>
        {query.isLoading ? (
          <p className="mt-6 text-[0.9375rem] text-muted-foreground">Finding chapter…</p>
        ) : query.data ? (
          <div className="mt-6 space-y-4">
            {query.data.verses.map((verse) => (
              <p key={verse.verse} className="scripture">
                <Link
                  to="/verse/$translation/$book/$chapter/$verse"
                  params={{ ...params, verse: String(verse.verse) }}
                  className="mr-2 align-super font-sans text-xs font-semibold text-primary"
                >
                  {verse.verse}
                </Link>
                {verse.text}
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{message}</p>
            {query.isError ? (
              <Button variant="outline" className="mt-4" onClick={() => query.refetch()}>
                Try again
              </Button>
            ) : null}
          </div>
        )}
      </article>

      <nav className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-4 text-[0.875rem]">
        {previous ? (
          <Link
            to="/chapter/$translation/$book/$chapter"
            params={{
              translation: params.translation,
              book: previous.bookId,
              chapter: String(previous.chapter),
            }}
            className="flex min-w-0 items-center gap-1 text-primary"
          >
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{previous.label}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            to="/chapter/$translation/$book/$chapter"
            params={{
              translation: params.translation,
              book: next.bookId,
              chapter: String(next.chapter),
            }}
            className="flex min-w-0 items-center gap-1 text-primary"
          >
            <span className="truncate">{next.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </AppShell>
  );
}
