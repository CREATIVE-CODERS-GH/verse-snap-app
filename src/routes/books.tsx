import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookCard,
  BookRow,
  BookSearchField,
  CategoryChips,
  CONTINUE_BAR_INNER,
  CONTINUE_BAR_OUTER,
  ContinueBarContent,
  GroupHeading,
  TestamentTabs,
} from "@/components/book-index-parts";
import { BottomNav } from "@/components/bottom-nav";
import { ChapterToast } from "@/components/chapter-reader-parts";
import { NoResultsIllustration, StateMessage } from "@/components/search-states";
import {
  ALL_GROUP_ID,
  allGroupOf,
  BOOK_GROUPS,
  booksOfGroup,
  booksOfTestament,
  groupOfBook,
  groupsOf,
  searchBooks,
  type Testament,
} from "@/lib/bible/book-groups";
import { findBook } from "@/lib/bible/books";
import { getStoredLastRead, type LastRead } from "@/lib/last-read";
import { usePreferences } from "@/lib/preferences";
import { useDictation } from "@/lib/use-dictation";

export const Route = createFileRoute("/books")({
  validateSearch: (search: Record<string, unknown>): { translation?: string; book?: string } => {
    const translation = search["translation"];
    const book = search["book"];
    return {
      ...(typeof translation === "string" && translation ? { translation } : {}),
      ...(typeof book === "string" && findBook(book) ? { book } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Books & chapters — Verse Snap" },
      { name: "description", content: "Browse every book of the Bible and open any chapter." },
      { property: "og:title", content: "Books & chapters — Verse Snap" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BooksPage,
});

const VISIBLE_ROWS = 6;
const DEFAULT_BOOK = "john";
const TOAST_MS = 2600;

function BooksPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { translation: preferred } = usePreferences();

  // The saved reading position is browser-only, so it is read after the page has loaded.
  const [lastRead, setLastReadState] = useState<LastRead | null>(null);
  const translation = search.translation ?? lastRead?.translation ?? preferred;

  const startBook = search.book ?? DEFAULT_BOOK;
  const [testament, setTestament] = useState<Testament>(groupOfBook(startBook)?.testament ?? "nt");
  // "All" is the default; a group is only preselected when the page opens on a book.
  const [category, setCategory] = useState(
    search.book ? (groupOfBook(search.book)?.id ?? ALL_GROUP_ID) : ALL_GROUP_ID,
  );
  const [expandedId, setExpandedId] = useState<string | null>(search.book ?? null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Just after the last visible book: when it scrolls into view the rest of the group appears.
  const revealRef = useRef<HTMLDivElement | null>(null);
  const shownBookId = useRef<string | null>(expandedId);

  const showToast = (text: string) => {
    setToast(text);
    setToastVisible(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), TOAST_MS);
  };
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const dictation = useDictation((text) => setQuery(text));
  useEffect(() => {
    if (dictation.state === "unsupported") showToast("Voice input isn't available on this device");
    if (dictation.state === "error") showToast("Couldn't hear that. Try again");
  }, [dictation.state]);

  // Open on the saved reading position when the address does not name a book.
  useEffect(() => {
    const stored = getStoredLastRead();
    setLastReadState(stored);
    // A book opens on arrival only when the address names it or it is the one last read; with no
    // context every book starts closed.
    const bookId = search.book ?? stored?.bookId ?? null;
    const group = groupOfBook(bookId ?? DEFAULT_BOOK);
    if (group) {
      setTestament(group.testament);
      setCategory(bookId ? group.id : ALL_GROUP_ID);
    }
    setExpandedId(bookId);
    setSelectedChapter(bookId && stored && stored.bookId === bookId ? stored.chapter : null);
    // Runs once; later changes come from the person using the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allGroup = useMemo(() => allGroupOf(testament), [testament]);
  const activeGroups = useMemo(() => [allGroup, ...groupsOf(testament)], [allGroup, testament]);
  const activeGroup =
    category === ALL_GROUP_ID
      ? allGroup
      : (BOOK_GROUPS.find((group) => group.id === category && group.testament === testament) ??
        allGroup);
  const searching = query.trim().length > 0;
  const books = useMemo(
    () => (searching ? searchBooks(query) : booksOfGroup(activeGroup)),
    [searching, query, activeGroup],
  );
  const visibleBooks = useMemo(() => {
    if (showAll || searching) return books;
    const head = books.slice(0, VISIBLE_ROWS);
    const expandedIndex = books.findIndex((book) => book.id === expandedId);
    return expandedIndex >= VISIBLE_ROWS ? [...head, books[expandedIndex]!] : head;
  }, [books, showAll, searching, expandedId]);
  const hiddenBooks = books.filter((book) => !visibleBooks.includes(book));
  const hasHidden = hiddenBooks.length > 0;

  // The rest of the group appears on its own as the person scrolls towards the end of the list
  // (a little before it, so the rows are already there), or at once if the list fits on screen.
  useEffect(() => {
    const marker = revealRef.current;
    if (!hasHidden || !marker) return;
    if (typeof IntersectionObserver === "undefined") {
      setShowAll(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShowAll(true);
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [hasHidden, category, testament]);
  const counts = {
    ot: booksOfTestament("ot").length,
    nt: booksOfTestament("nt").length,
  };

  // Keep the opened book in view when the person picks another one.
  useEffect(() => {
    if (shownBookId.current === expandedId) return;
    shownBookId.current = expandedId;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [expandedId]);

  const chooseBook = (bookId: string) => {
    setExpandedId(bookId);
    setSelectedChapter(lastRead && lastRead.bookId === bookId ? lastRead.chapter : null);
  };

  const enterGroup = (testamentValue: Testament, groupId: string) => {
    const group =
      groupId === ALL_GROUP_ID
        ? allGroupOf(testamentValue)
        : BOOK_GROUPS.find((item) => item.id === groupId);
    if (!group) return;
    setTestament(testamentValue);
    setCategory(group.id);
    setShowAll(false);
    // Switching testament or category leaves every book closed; the person opens the one they want.
    setExpandedId(null);
    setSelectedChapter(null);
  };

  const openChapter = (bookId: string, chapter: number) =>
    navigate({
      to: "/chapter/$translation/$book/$chapter",
      params: { translation, book: bookId, chapter: String(chapter) },
    });

  const expandedBook = expandedId ? findBook(expandedId) : undefined;

  // The bar opens the chapter that is picked in the grid, otherwise the saved reading position.
  const fallback = lastRead ?? { translation, bookId: DEFAULT_BOOK, chapter: 1 };
  const target =
    expandedBook && selectedChapter
      ? { bookId: expandedBook.id, chapter: selectedChapter }
      : { bookId: fallback.bookId, chapter: fallback.chapter };
  const targetBook = findBook(target.bookId);
  const isSavedPosition =
    lastRead !== null && lastRead.bookId === target.bookId && lastRead.chapter === target.chapter;
  const barLabel = isSavedPosition
    ? "Continue reading"
    : lastRead
      ? "Open chapter"
      : "Start reading";

  return (
    <div className="flex min-h-dvh flex-col bg-ch-surface font-stitch text-ch-on-surface">
      <main className="relative flex w-full flex-1 flex-col pt-[env(safe-area-inset-top)]">
        <div className="flex w-full flex-col pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-5 pt-6">
            <BookSearchField
              value={query}
              onChange={setQuery}
              onMic={dictation.toggle}
              listening={dictation.state === "listening"}
            />
            <TestamentTabs
              value={testament}
              counts={counts}
              onChange={(next) => {
                enterGroup(next, ALL_GROUP_ID);
                setQuery("");
              }}
            />
            <CategoryChips
              groups={activeGroups}
              active={activeGroup.id}
              onChange={(id) => {
                enterGroup(testament, id);
                setQuery("");
              }}
            />
          </div>

          <div
            role="tabpanel"
            aria-labelledby={`tab-${testament}`}
            className="mx-auto mt-6 flex w-full max-w-xl flex-col gap-4 px-5"
          >
            <GroupHeading
              label={searching ? "Search results" : activeGroup.label}
              count={books.length}
            />

            {books.length === 0 ? (
              <StateMessage illustration={<NoResultsIllustration />} title="No books found">
                Try a different spelling, such as “Philippians” or “1 John”.
              </StateMessage>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleBooks.map((book, index) => {
                  const kind = (groupOfBook(book.id) ?? activeGroup).kind;
                  // Rows that appear while scrolling fade in gently.
                  const revealed =
                    showAll && !searching && index >= VISIBLE_ROWS
                      ? "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
                      : undefined;
                  if (book.id !== expandedId) {
                    return (
                      <div key={book.id} className={revealed}>
                        <BookRow book={book} kind={kind} onSelect={() => chooseBook(book.id)} />
                      </div>
                    );
                  }
                  return (
                    <div key={book.id} ref={cardRef} className="mb-2 mt-2 scroll-mt-6 first:mt-0">
                      <BookCard
                        book={book}
                        selectedChapter={selectedChapter}
                        // One tap opens the chapter straight away.
                        onSelectChapter={(chapter) => openChapter(book.id, chapter)}
                        lastRead={
                          lastRead && lastRead.bookId === book.id
                            ? `Last read: ${book.name} ${lastRead.chapter}`
                            : null
                        }
                        onClose={() => {
                          setExpandedId(null);
                          setSelectedChapter(null);
                        }}
                      />
                    </div>
                  );
                })}
                {hasHidden ? <div ref={revealRef} aria-hidden className="h-px" /> : null}
              </div>
            )}
          </div>
        </div>
      </main>

      <div className={CONTINUE_BAR_OUTER}>
        {targetBook ? (
          <Link
            to="/chapter/$translation/$book/$chapter"
            params={{
              translation,
              book: target.bookId,
              chapter: String(target.chapter),
            }}
            aria-label={`${barLabel}: ${targetBook.name} ${target.chapter}`}
            className={CONTINUE_BAR_INNER}
          >
            <ContinueBarContent label={barLabel} target={`${targetBook.name} ${target.chapter}`} />
          </Link>
        ) : null}
      </div>

      <BottomNav />
      <ChapterToast
        message={toast}
        visible={toastVisible}
        positionClass="bottom-[calc(7.5rem+env(safe-area-inset-bottom))]"
      />
    </div>
  );
}
