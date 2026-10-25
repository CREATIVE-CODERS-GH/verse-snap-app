import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { BookmarkIcon, CheckIcon, SearchIcon, TuneIcon } from "@/components/stitch-icons";
import {
  SavedHighlightsHub,
  SavedNotesHub,
  SavedSearchBar,
  SavedTabs,
  SavedVersesHub,
  type ChipOption,
} from "@/components/saved-hubs";
import { toneInfo } from "@/components/verse-annotation-parts";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { useAuth } from "@/lib/auth";
import { HIGHLIGHT_COLORS, highlights, type SavedHighlight } from "@/lib/highlights";
import { journal, type Reflection } from "@/lib/journal";
import { plainNote } from "@/lib/reflection-format";
import { library, type LibraryEntry } from "@/lib/library";
import {
  matchesShelf,
  SEARCH_PLACEHOLDERS,
  SHELF_LABELS,
  tagCounts,
  verseReference,
  type SavedTab,
  type ShelfFilter,
} from "@/lib/saved-hubs";

/*
 * Saved — the header (title, search, sort menu) is Stitch "09 Saved Verses"; below it three hubs:
 * Verses (33), Highlights (34) and Notes (31), chosen by the tabs (?tab=). "14 Saved Empty State"
 * shows when there is nothing in any of them. Verses use the same saved-verse library as the verse
 * screens, highlights the same store as the chapter reader, notes the Reflection Journal (account
 * when signed in, this device otherwise).
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
  validateSearch: (search: Record<string, unknown>): { tab?: SavedTab } => {
    const tab = search["tab"];
    return tab === "verses" || tab === "highlights" || tab === "notes" ? { tab } : {};
  },
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

function reflectionReference(item: Reflection): string {
  return verseReference(item);
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

function sortEntries<T extends { bookId: string; chapter: number; verse: number; at: string }>(
  entries: T[],
  order: SortOrder,
): T[] {
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
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>("newest");
  const [editing, setEditing] = useState(false);
  const [notebookFilter, setNotebookFilter] = useState("all");
  const [shelf, setShelf] = useState<ShelfFilter>("all");
  const [colour, setColour] = useState("all");
  const [tag, setTag] = useState("all");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const owner = user?.id ?? "guest";
  const journalOn = journal.persists(user?.id);
  const highlightsOn = highlights.persists(user?.id);
  const tabs: readonly SavedTab[] = journalOn
    ? ["verses", "notes", "highlights"]
    : ["verses", "highlights"];
  const requested = Route.useSearch().tab ?? "verses";
  const tab: SavedTab = tabs.includes(requested) ? requested : "verses";

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
        matchesShelf(entry.bookId, shelf) &&
        (!needle ||
          reference(entry).toLowerCase().includes(needle) ||
          entry.verseText.toLowerCase().includes(needle) ||
          entry.translation.toLowerCase().includes(needle)),
    );
    return sortEntries(filtered, order);
  }, [data, order, query, shelf]);
  const shelves: ChipOption[] = (Object.keys(SHELF_LABELS) as ShelfFilter[])
    .map((id) => ({
      id,
      label: SHELF_LABELS[id],
      count: (data ?? []).filter((entry) => matchesShelf(entry.bookId, id)).length,
    }))
    .filter((option) => option.id === "all" || option.count > 0);

  // Highlights (the chapter reader's store).
  const highlightsQuery = useQuery({
    queryKey: ["highlights", "all", owner],
    queryFn: () => highlights.list(user?.id),
    enabled: !loading && highlightsOn,
  });
  const highlightItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (highlightsQuery.data ?? []).filter(
      (item: SavedHighlight) =>
        (colour === "all" || item.color === colour) &&
        (!needle ||
          verseReference(item).toLowerCase().includes(needle) ||
          item.translation.toLowerCase().includes(needle) ||
          toneInfo(item.color).name.toLowerCase().includes(needle)),
    );
    return sortEntries(filtered, order);
  }, [highlightsQuery.data, colour, order, query]);
  const colours: ChipOption[] = [
    { id: "all", label: "All", count: highlightsQuery.data?.length ?? 0 },
    ...HIGHLIGHT_COLORS.map((id) => ({
      id: id as string,
      label: toneInfo(id).label,
      count: (highlightsQuery.data ?? []).filter((item) => item.color === id).length,
      dot: toneInfo(id).swatch,
    })).filter((option) => option.count > 0),
  ];

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
        (tag === "all" || item.tags.includes(tag)) &&
        (!needle ||
          reflectionReference(item).toLowerCase().includes(needle) ||
          item.title.toLowerCase().includes(needle) ||
          plainNote(item.body).toLowerCase().includes(needle) ||
          item.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
          item.translation.toLowerCase().includes(needle)),
    );
    return sortReflections(filtered, order);
  }, [reflectionsQuery.data, notebookFilter, tag, order, query]);
  const hasReflections = (reflectionsQuery.data?.length ?? 0) > 0;
  const tagOptions: ChipOption[] = [
    { id: "all", label: "All", count: reflectionsQuery.data?.length ?? 0 },
    ...tagCounts(reflectionsQuery.data ?? []).map((item) => ({
      id: item.tag,
      label: `#${item.tag}`,
      count: item.count,
    })),
  ];

  const busy = loading || isLoading;
  const hasHighlights = (highlightsQuery.data?.length ?? 0) > 0;
  const empty =
    !busy &&
    (!data || data.length === 0) &&
    !hasReflections &&
    !hasHighlights &&
    !reflectionsQuery.isLoading &&
    !highlightsQuery.isLoading;
  const isEditing = editing && tab === "verses";
  useEffect(() => setQuery(""), [tab]);

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
                aria-label="Search saved"
                onClick={() => {
                  searchRef.current?.scrollIntoView({ block: "nearest" });
                  searchRef.current?.focus();
                }}
                className={ICON_BUTTON}
              >
                <SearchIcon className="h-[22px] w-[22px]" strokeWidth={2} />
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
                    {tab === "highlights" ? null : (
                      <DropdownMenu.Separator className="my-1 h-px bg-brand-border" />
                    )}
                    {tab === "notes" ? (
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
                    ) : tab === "verses" ? (
                      <DropdownMenu.Item
                        className={MENU_ITEM}
                        onSelect={() => setEditing((v) => !v)}
                      >
                        {isEditing ? "Done editing" : "Edit list"}
                      </DropdownMenu.Item>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>

          <SavedTabs
            active={tab}
            tabs={tabs}
            counts={{
              verses: data?.length,
              highlights: highlightsOn ? highlightsQuery.data?.length : undefined,
              notes: journalOn ? reflectionsQuery.data?.length : undefined,
            }}
          />

          <SavedSearchBar
            value={query}
            onChange={setQuery}
            placeholder={SEARCH_PLACEHOLDERS[tab]}
            inputRef={searchRef}
          />

          {isEditing ? (
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

          {tab === "highlights" ? (
            <SavedHighlightsHub
              items={highlightItems}
              total={highlightsQuery.data?.length ?? 0}
              query={query}
              colour={colour}
              colours={colours}
              onColour={setColour}
              notes={reflectionsQuery.data ?? []}
              loading={highlightsQuery.isLoading}
              failed={highlightsQuery.isError}
              sortLabel={SORT_LABELS[order]}
            />
          ) : tab === "notes" ? (
            <SavedNotesHub
              items={reflections}
              total={reflectionsQuery.data?.length ?? 0}
              query={query}
              tag={tag}
              tags={tagOptions}
              onTag={setTag}
              notebookName={notebookName}
              loading={reflectionsQuery.isLoading}
              failed={reflectionsQuery.isError}
              sortLabel={SORT_LABELS[order]}
            />
          ) : (
            <SavedVersesHub
              entries={entries}
              total={data?.length ?? 0}
              query={query}
              shelf={shelf}
              shelves={shelves}
              onShelf={setShelf}
              notes={reflectionsQuery.data ?? []}
              loading={busy}
              editing={isEditing}
              onRemove={(id) => remove.mutate(id)}
              removing={remove.isPending}
              sortLabel={SORT_LABELS[order]}
            />
          )}
        </main>
      )}
    </AppShell>
  );
}
