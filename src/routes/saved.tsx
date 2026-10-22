import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
  TuneIcon,
} from "@/components/stitch-icons";
import { BIBLE_BOOKS, findBook } from "@/lib/bible/books";
import { useAuth } from "@/lib/auth";
import { journal, type Reflection } from "@/lib/journal";
import { plainNote } from "@/lib/reflection-format";
import { library, type LibraryEntry } from "@/lib/library";
import { cn } from "@/lib/utils";

/*
 * Saved — Stitch "09 Saved Verses" (list) and "14 Saved Empty State". Uses the same saved-verse
 * library as the verse screens (account when signed in, this device otherwise). The sort menu's
 * "Show" choice also lists the Reflection Journal (same rows; a notebook filter), which opens each
 * note in the reflection editor.
 */

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

type SortOrder = "newest" | "oldest" | "bible";

const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  bible: "Bible order",
};

const BOOK_ORDER = new Map(BIBLE_BOOKS.map((book, index) => [book.id, index]));

const ICON_BUTTON =
  "flex h-10 w-10 items-center justify-center rounded-full text-brand-text transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus";
const MENU_ITEM =
  "flex w-full cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors data-[highlighted]:bg-brand-surface-muted";

function reference(entry: LibraryEntry): string {
  return `${entry.bookName} ${entry.chapter}:${entry.verse}`;
}

type View = "verses" | "reflections";

function reflectionReference(item: Reflection): string {
  return `${findBook(item.bookId)?.name ?? item.bookId} ${item.chapter}:${item.verse}`;
}

function sortReflections(items: Reflection[], order: SortOrder): Reflection[] {
  const list = [...items];
  if (order === "bible") {
    return list.sort(
      (a, b) =>
        (BOOK_ORDER.get(a.bookId) ?? 999) - (BOOK_ORDER.get(b.bookId) ?? 999) ||
        a.chapter - b.chapter ||
        a.verse - b.verse,
    );
  }
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return order === "oldest" ? list.reverse() : list;
}

function sortEntries(entries: LibraryEntry[], order: SortOrder): LibraryEntry[] {
  const list = [...entries];
  if (order === "bible") {
    return list.sort(
      (a, b) =>
        (BOOK_ORDER.get(a.bookId) ?? 999) - (BOOK_ORDER.get(b.bookId) ?? 999) ||
        a.chapter - b.chapter ||
        a.verse - b.verse,
    );
  }
  list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return order === "oldest" ? list.reverse() : list;
}

function SavedPage() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>("newest");
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<View>("verses");
  const [notebookFilter, setNotebookFilter] = useState("all");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const owner = user?.id ?? "guest";
  const journalOn = journal.persists(user?.id);

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

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (data ?? []).filter(
      (entry) =>
        !needle ||
        reference(entry).toLowerCase().includes(needle) ||
        entry.verseText.toLowerCase().includes(needle) ||
        entry.translation.toLowerCase().includes(needle),
    );
    return sortEntries(filtered, order);
  }, [data, order, query]);

  // The Reflection Journal (same keys as the reflection editor).
  const reflectionsQuery = useQuery({
    queryKey: ["reflections", owner],
    queryFn: () => journal.listReflections(user?.id),
    enabled: !loading && journalOn,
  });
  const notebooksQuery = useQuery({
    queryKey: ["notebooks", owner],
    queryFn: () => journal.listNotebooks(user?.id),
    enabled: !loading && journalOn,
  });
  const notebooks = notebooksQuery.data ?? [];
  const notebookName = (id: string) =>
    notebooks.find((item) => item.id === id)?.name ??
    notebooks.find((item) => item.isDefault)?.name;
  const reflections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (reflectionsQuery.data ?? []).filter(
      (item) =>
        (notebookFilter === "all" || item.notebookId === notebookFilter) &&
        (!needle ||
          reflectionReference(item).toLowerCase().includes(needle) ||
          item.title.toLowerCase().includes(needle) ||
          plainNote(item.body).toLowerCase().includes(needle) ||
          item.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
          item.translation.toLowerCase().includes(needle)),
    );
    return sortReflections(filtered, order);
  }, [reflectionsQuery.data, notebookFilter, order, query]);
  const hasReflections = (reflectionsQuery.data?.length ?? 0) > 0;
  const showingReflections = view === "reflections" && journalOn;

  const busy = loading || isLoading;
  const empty =
    !busy && (!data || data.length === 0) && !hasReflections && !reflectionsQuery.isLoading;

  const reflectionList = reflectionsQuery.isLoading ? (
    <ul aria-label="Loading reflections" className="divide-y divide-brand-border">
      {[0, 1, 2].map((item) => (
        <li key={item} className="space-y-2 py-4" aria-hidden>
          <span className="block h-4 w-32 animate-pulse rounded bg-brand-surface-strong" />
          <span className="block h-3 w-full animate-pulse rounded bg-brand-surface-muted" />
        </li>
      ))}
    </ul>
  ) : reflectionsQuery.isError ? (
    <p className="py-10 text-center text-[15px] text-brand-text-muted" role="status">
      Couldn’t load your reflections. Check your connection and try again.
    </p>
  ) : reflections.length === 0 ? (
    <p className="py-10 text-center text-[15px] text-brand-text-muted" role="status">
      {query.trim()
        ? `No reflections match “${query.trim()}”.`
        : hasReflections
          ? "No reflections in this notebook yet."
          : "No reflections yet. Open a verse and choose Add Reflection."}
    </p>
  ) : (
    <ul aria-label="Reflections" className="divide-y divide-brand-border">
      {reflections.map((item) => (
        <li key={item.id}>
          <Link
            to="/reflect/$translation/$book/$chapter/$verse"
            params={{
              translation: item.translation,
              book: item.bookId,
              chapter: String(item.chapter),
              verse: String(item.verse),
            }}
            className="group flex min-w-0 items-start justify-between py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
          >
            <span className="min-w-0 space-y-1 pr-4">
              <span className="block text-base font-bold text-brand-text transition-colors group-hover:text-brand-primary">
                {reflectionReference(item)}
              </span>
              <span className="line-clamp-2 block text-sm leading-relaxed text-brand-text-muted">
                {item.title.trim() || plainNote(item.body).trim()}
              </span>
              <span className="block pt-0.5 text-xs font-semibold tracking-wider text-brand-text-faint">
                {item.translation}
                {notebookName(item.notebookId) ? ` · ${notebookName(item.notebookId)}` : ""}
              </span>
            </span>
            <ChevronRightIcon
              className="mt-1 h-5 w-5 shrink-0 text-brand-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-brand-text-muted"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <AppShell variant="stitch">
      {empty ? (
        /* ---------- 14 Saved Empty State ---------- */
        <main className="flex flex-1 flex-col items-center justify-center px-2 pb-10 text-center">
          <h1 className="sr-only">Saved</h1>
          <BookmarkIcon className="mb-6 h-14 w-14 text-brand-text" strokeWidth={1.6} aria-hidden />
          <h2 className="font-display text-[26px] font-bold leading-tight tracking-tight text-brand-text">
            No saved verses yet
          </h2>
          <p className="mt-3 max-w-[290px] text-[15px] leading-relaxed text-brand-text-muted">
            When you find a verse you want to remember, tap the save icon on the verse screen.
          </p>
          <Link
            to="/search"
            className="mt-8 rounded-full bg-brand-primary px-10 py-3.5 text-[15px] font-semibold text-brand-on-primary shadow-md transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas"
          >
            Find a Verse
          </Link>
        </main>
      ) : (
        /* ---------- 09 Saved Verses ---------- */
        <main className="flex flex-1 flex-col">
          <header className="flex items-center justify-between pb-3 pt-5">
            <h1 className="text-[32px] font-bold leading-tight tracking-tight text-brand-text">
              Saved
            </h1>
            <div className="-mr-2 flex items-center gap-2">
              <button
                type="button"
                aria-label={searching ? "Close search" : "Search saved verses"}
                aria-expanded={searching}
                onClick={() => {
                  const next = !searching;
                  setSearching(next);
                  if (!next) setQuery("");
                  else window.requestAnimationFrame(() => searchRef.current?.focus());
                }}
                className={ICON_BUTTON}
              >
                {searching ? (
                  <CloseIcon className="h-[22px] w-[22px]" strokeWidth={2} />
                ) : (
                  <SearchIcon className="h-[22px] w-[22px]" strokeWidth={2} />
                )}
              </button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" aria-label="Sort and organize" className={ICON_BUTTON}>
                    <TuneIcon className="h-[22px] w-[22px]" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="z-[70] min-w-52 rounded-2xl border border-brand-border bg-brand-surface p-1.5 font-stitch text-brand-text shadow-xl"
                  >
                    {journalOn ? (
                      <>
                        <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-text-muted">
                          Show
                        </DropdownMenu.Label>
                        <DropdownMenu.RadioGroup
                          value={view}
                          onValueChange={(value) => {
                            setView(value as View);
                            setEditing(false);
                          }}
                        >
                          {(
                            [
                              ["verses", "Saved verses"],
                              ["reflections", "Reflections"],
                            ] as const
                          ).map(([key, label]) => (
                            <DropdownMenu.RadioItem key={key} value={key} className={MENU_ITEM}>
                              {label}
                              <DropdownMenu.ItemIndicator>
                                <CheckIcon className="h-4 w-4 text-brand-primary" />
                              </DropdownMenu.ItemIndicator>
                            </DropdownMenu.RadioItem>
                          ))}
                        </DropdownMenu.RadioGroup>
                        <DropdownMenu.Separator className="my-1 h-px bg-brand-border" />
                      </>
                    ) : null}
                    <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Sort by
                    </DropdownMenu.Label>
                    <DropdownMenu.RadioGroup
                      value={order}
                      onValueChange={(value) => setOrder(value as SortOrder)}
                    >
                      {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                        <DropdownMenu.RadioItem key={key} value={key} className={MENU_ITEM}>
                          {SORT_LABELS[key]}
                          <DropdownMenu.ItemIndicator>
                            <CheckIcon className="h-4 w-4 text-brand-primary" />
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                    <DropdownMenu.Separator className="my-1 h-px bg-brand-border" />
                    {showingReflections ? (
                      <>
                        <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-text-muted">
                          Notebook
                        </DropdownMenu.Label>
                        <DropdownMenu.RadioGroup
                          value={notebookFilter}
                          onValueChange={setNotebookFilter}
                        >
                          {[{ id: "all", name: "All notebooks" }, ...notebooks].map((item) => (
                            <DropdownMenu.RadioItem
                              key={item.id}
                              value={item.id}
                              className={MENU_ITEM}
                            >
                              <span className="truncate">{item.name}</span>
                              <DropdownMenu.ItemIndicator>
                                <CheckIcon className="h-4 w-4 text-brand-primary" />
                              </DropdownMenu.ItemIndicator>
                            </DropdownMenu.RadioItem>
                          ))}
                        </DropdownMenu.RadioGroup>
                      </>
                    ) : (
                      <DropdownMenu.Item
                        className={MENU_ITEM}
                        onSelect={() => setEditing((v) => !v)}
                      >
                        {editing ? "Done editing" : "Edit list"}
                      </DropdownMenu.Item>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>

          {searching ? (
            <div className="mb-2">
              <label htmlFor="saved-search" className="sr-only">
                Search saved verses
              </label>
              <input
                ref={searchRef}
                id="saved-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by reference or words"
                className="h-11 w-full rounded-full border border-brand-border bg-brand-surface px-4 text-[15px] text-brand-text placeholder:text-brand-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              />
            </div>
          ) : null}

          {editing ? (
            <div className="mb-1 flex items-center justify-between rounded-xl bg-brand-surface-muted px-3 py-2 text-[13px] text-brand-text-muted">
              Tap ✕ to remove a verse.
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full px-2 py-0.5 font-semibold text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                Done
              </button>
            </div>
          ) : null}

          {showingReflections ? (
            reflectionList
          ) : busy ? (
            <ul aria-label="Loading saved verses" className="divide-y divide-brand-border">
              {[0, 1, 2, 3].map((item) => (
                <li key={item} className="space-y-2 py-4" aria-hidden>
                  <span className="block h-4 w-32 animate-pulse rounded bg-brand-surface-strong" />
                  <span className="block h-3 w-full animate-pulse rounded bg-brand-surface-muted" />
                  <span className="block h-3 w-2/3 animate-pulse rounded bg-brand-surface-muted" />
                </li>
              ))}
            </ul>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-brand-text-muted" role="status">
              {query.trim() ? `No saved verses match “${query.trim()}”.` : "No saved verses yet."}
            </p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start">
                  <Link
                    to="/verse/$translation/$book/$chapter/$verse"
                    params={{
                      translation: entry.translation,
                      book: entry.bookId,
                      chapter: String(entry.chapter),
                      verse: String(entry.verse),
                    }}
                    className="group flex min-w-0 flex-1 items-start justify-between py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
                  >
                    <span className="min-w-0 space-y-1 pr-4">
                      <span className="block text-base font-bold text-brand-text transition-colors group-hover:text-brand-primary">
                        {reference(entry)}
                      </span>
                      {entry.verseText ? (
                        <span className="line-clamp-2 block text-sm leading-relaxed text-brand-text-muted">
                          {entry.verseText}
                        </span>
                      ) : null}
                      <span className="block pt-0.5 text-xs font-semibold tracking-wider text-brand-text-faint">
                        {entry.translation}
                      </span>
                    </span>
                    {editing ? null : (
                      <ChevronRightIcon
                        className="mt-1 h-5 w-5 shrink-0 text-brand-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-brand-text-muted"
                        aria-hidden
                      />
                    )}
                  </Link>
                  {editing ? (
                    <button
                      type="button"
                      aria-label={`Remove ${reference(entry)}`}
                      onClick={() => remove.mutate(entry.id)}
                      disabled={remove.isPending}
                      className={cn(
                        "mt-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-brand-text-muted transition-colors hover:bg-brand-danger-soft hover:text-brand-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-50",
                      )}
                    >
                      <CloseIcon className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </AppShell>
  );
}
