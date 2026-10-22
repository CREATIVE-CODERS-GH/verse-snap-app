import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import {
  BookmarkIcon,
  ChevronRightIcon,
  CloseIcon,
  EditNoteIcon,
  HighlighterIcon,
  MicIcon,
  PagesIcon,
  PaletteIcon,
  SearchIcon,
  StickyNoteIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { toneInfo } from "@/components/verse-annotation-parts";
import { findBook } from "@/lib/bible/books";
import { bibleService } from "@/lib/bible/service";
import type { SavedHighlight } from "@/lib/highlights";
import type { Reflection } from "@/lib/journal";
import type { LibraryEntry } from "@/lib/library";
import { plainNote } from "@/lib/reflection-format";
import {
  notesOnVerse,
  relativeTime,
  verseReference,
  type SavedTab,
  type ShelfFilter,
} from "@/lib/saved-hubs";
import { useDictation } from "@/lib/use-dictation";
import { useSpeak } from "@/lib/use-speak";
import { cn } from "@/lib/utils";

/*
 * The three Saved hubs (Stitch 33 Saved Verses Hub, 34 Scriptural Highlights Hub, 31 Notes &
 * Reflections Journal Hub). The Saved page keeps its own header; this file draws what is under it.
 */

const CARD = "rounded-2xl border border-brand-border bg-brand-surface p-4";
const CHIP_BASE =
  "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus";
const ACTION =
  "flex min-h-11 items-center gap-1.5 rounded-full border border-brand-border px-3.5 text-[13px] font-semibold text-brand-text transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus";
const META = "text-xs font-semibold tracking-wide text-brand-text-faint";
const EDITION_CHIP =
  "shrink-0 rounded-full bg-brand-surface-muted px-2.5 py-1 text-[11px] font-semibold tracking-wider text-brand-text-muted";

/* ---------- tabs and chips ---------- */

const TAB_LABELS: Record<SavedTab, string> = {
  verses: "Verses",
  highlights: "Highlights",
  notes: "Notes",
};

const TAB_ICONS: Record<SavedTab, (active: boolean) => ReactNode> = {
  verses: (active) => <BookmarkIcon className="h-[17px] w-[17px]" filled={active} />,
  highlights: () => <HighlighterIcon className="h-[17px] w-[17px]" />,
  notes: () => <StickyNoteIcon className="h-[17px] w-[17px]" />,
};

/**
 * The Verses · Highlights · Notes toggle (Stitch 33/34/31 "Segmented Tabs"): a row of rounded
 * pills, each with an icon, its label and a count badge. The active pill is solid brand green; the
 * others are pale. The tab is kept in the address (?tab=).
 */
export function SavedTabs({
  active,
  counts,
  tabs,
}: {
  active: SavedTab;
  counts: Record<SavedTab, number | undefined>;
  tabs: readonly SavedTab[];
}) {
  return (
    <nav
      aria-label="Saved sections"
      className="-mx-5 mb-3 flex items-center gap-2 overflow-x-auto px-5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const on = tab === active;
        return (
          <Link
            key={tab}
            to="/saved"
            search={{ tab }}
            replace
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas",
              on
                ? "bg-brand-primary text-brand-on-primary shadow-sm active:scale-95"
                : "bg-brand-surface-muted text-brand-text-muted hover:bg-brand-surface-strong hover:text-brand-text",
            )}
          >
            {TAB_ICONS[tab](on)}
            <span>{TAB_LABELS[tab]}</span>
            {counts[tab] !== undefined ? (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-tight",
                  on
                    ? "bg-white/20 font-semibold text-brand-on-primary"
                    : "bg-brand-surface-strong font-medium text-brand-text-muted",
                )}
              >
                {counts[tab]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The search bar under the toggle (Stitch 33/34/31): a pill field with a voice-search mic. */
export function SavedSearchBar({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const dictation = useDictation((text) => onChange(text));
  useEffect(() => {
    if (dictation.state === "unsupported") {
      toast("Voice search isn’t supported in this browser — try your keyboard’s mic");
    } else if (dictation.state === "error") {
      toast("Couldn’t hear that — check microphone access and try again");
    }
  }, [dictation.state]);
  return (
    <div className="relative mb-3 flex w-full items-center">
      <SearchIcon
        className="pointer-events-none absolute left-3.5 h-5 w-5 text-brand-text-muted"
        aria-hidden
      />
      <label htmlFor="saved-search" className="sr-only">
        {placeholder}
      </label>
      <input
        ref={inputRef}
        id="saved-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-full border border-brand-border bg-brand-surface pl-10 pr-12 text-[15px] text-brand-text shadow-sm placeholder:text-brand-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
      />
      <button
        type="button"
        aria-label={dictation.state === "listening" ? "Stop voice search" : "Voice search"}
        aria-pressed={dictation.state === "listening"}
        onClick={dictation.toggle}
        className={cn(
          "absolute right-1 flex h-9 w-9 items-center justify-center rounded-full text-brand-primary transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
          dictation.state === "listening" && "animate-pulse bg-brand-surface-muted",
        )}
      >
        <MicIcon className="h-[19px] w-[19px]" aria-hidden />
      </button>
    </div>
  );
}

export interface ChipOption {
  id: string;
  label: string;
  count?: number;
  /** A colour dot class, for the highlight colours. */
  dot?: string;
}

export function FilterChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly ChipOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-5 mb-3 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            className={cn(
              CHIP_BASE,
              on
                ? "bg-brand-primary text-brand-on-primary"
                : "bg-brand-surface-muted text-brand-text hover:bg-brand-surface-strong",
            )}
          >
            {option.dot ? (
              <span className={cn("h-2.5 w-2.5 rounded-full", option.dot)} aria-hidden />
            ) : null}
            {option.label}
            {option.count !== undefined ? (
              <span className={on ? "opacity-80" : "text-brand-text-muted"}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SectionLine({ title, sortLabel }: { title: string; sortLabel: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-brand-text-muted">
        {title}
      </h2>
      <p className="text-xs text-brand-text-faint">{sortLabel}</p>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="py-10 text-center text-[15px] text-brand-text-muted" role="status">
      {children}
    </p>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {[0, 1, 2].map((item) => (
        <li key={item} className={cn(CARD, "space-y-2")} aria-hidden>
          <span className="block h-4 w-32 animate-pulse rounded bg-brand-surface-strong" />
          <span className="block h-3 w-full animate-pulse rounded bg-brand-surface-muted" />
          <span className="block h-3 w-2/3 animate-pulse rounded bg-brand-surface-muted" />
        </li>
      ))}
    </ul>
  );
}

function ListenAction({ id, text }: { id: string; text: string }) {
  const speech = useSpeak((message) => toast(message));
  return (
    <button
      type="button"
      aria-pressed={speech.speaking}
      aria-label={speech.speaking ? `Stop listening to ${id}` : `Listen to ${id}`}
      onClick={() => speech.toggle(text)}
      className={ACTION}
    >
      {speech.speaking ? (
        <StopSquareIcon className="h-[18px] w-[18px]" aria-hidden />
      ) : (
        <VolumeIcon className="h-[18px] w-[18px]" aria-hidden />
      )}
      {speech.speaking ? "Stop" : "Listen"}
    </button>
  );
}

function verseParams(item: {
  translation: string;
  bookId: string;
  chapter: number;
  verse: number;
}) {
  return {
    translation: item.translation,
    book: item.bookId,
    chapter: String(item.chapter),
    verse: String(item.verse),
  };
}

function ReadInChapter({
  item,
  label = "Read in Chapter",
}: {
  item: { translation: string; bookId: string; chapter: number };
  label?: string;
}) {
  return (
    <Link
      to="/chapter/$translation/$book/$chapter"
      params={{
        translation: item.translation,
        book: item.bookId,
        chapter: String(item.chapter),
      }}
      className={ACTION}
    >
      <PagesIcon className="h-[18px] w-[18px]" aria-hidden />
      {label}
    </Link>
  );
}

function LinkedNotes({ notes }: { notes: Reflection[] }) {
  const first = notes[0];
  if (!first) return null;
  return (
    <Link
      to="/reflect/$translation/$book/$chapter/$verse"
      params={verseParams(first)}
      className="inline-flex min-h-8 items-center gap-1 rounded-full bg-brand-primary-soft px-2.5 text-xs font-semibold text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
    >
      <EditNoteIcon className="h-3.5 w-3.5" aria-hidden />
      {notes.length === 1 ? "1 Linked Note" : `${notes.length} Linked Notes`}
    </Link>
  );
}

/* ---------- Verses (33) ---------- */

function SavedVerseCard({
  entry,
  notes,
  editing,
  onRemove,
  removing,
}: {
  entry: LibraryEntry;
  notes: Reflection[];
  editing: boolean;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const reference = verseReference(entry);
  const linked = notesOnVerse(notes, entry);
  return (
    <li className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/verse/$translation/$book/$chapter/$verse"
          params={verseParams(entry)}
          className="min-w-0 rounded-sm text-base font-bold text-brand-text hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          {reference}
        </Link>
        <div className="flex items-center gap-1">
          <span className={EDITION_CHIP}>{entry.translation}</span>
          {editing ? (
            <button
              type="button"
              aria-label={`Remove ${reference}`}
              onClick={() => onRemove(entry.id)}
              disabled={removing}
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-text-muted transition-colors hover:bg-brand-danger-soft hover:text-brand-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-50"
            >
              <CloseIcon className="h-4 w-4" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      {entry.verseText ? (
        <p className="mt-2 line-clamp-4 font-display text-[15px] leading-relaxed text-brand-text">
          “{entry.verseText}”
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={META}>Saved {relativeTime(entry.at)}</span>
        <LinkedNotes notes={linked} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ReadInChapter item={entry} />
        <Link
          to="/card/$translation/$book/$chapter/$verse"
          params={verseParams(entry)}
          className={ACTION}
        >
          <PaletteIcon className="h-[18px] w-[18px]" aria-hidden />
          Card Studio
        </Link>
        <ListenAction id={reference} text={`${reference}. ${entry.verseText}`} />
      </div>
    </li>
  );
}

export function SavedVersesHub({
  entries,
  total,
  query,
  shelf,
  shelves,
  onShelf,
  notes,
  loading,
  editing,
  onRemove,
  removing,
  sortLabel,
}: {
  entries: LibraryEntry[];
  total: number;
  query: string;
  shelf: ShelfFilter;
  shelves: readonly ChipOption[];
  onShelf: (id: ShelfFilter) => void;
  notes: Reflection[];
  loading: boolean;
  editing: boolean;
  onRemove: (id: string) => void;
  removing: boolean;
  sortLabel: string;
}) {
  return (
    <section aria-label="Saved verses">
      {shelves.length > 1 ? (
        <FilterChips
          label="Filter saved verses"
          options={shelves}
          value={shelf}
          onChange={(id) => onShelf(id as ShelfFilter)}
        />
      ) : null}
      <SectionLine title={`All Saved Verses (${total})`} sortLabel={sortLabel} />
      {loading ? (
        <ListSkeleton label="Loading saved verses" />
      ) : entries.length === 0 ? (
        <Message>
          {query.trim()
            ? `No saved verses match “${query.trim()}”.`
            : total === 0
              ? "No saved verses yet. Tap the save icon on a verse to keep it here."
              : "No saved verses in this group."}
        </Message>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <SavedVerseCard
              key={entry.id}
              entry={entry}
              notes={notes}
              editing={editing}
              onRemove={onRemove}
              removing={removing}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Highlights (34) ---------- */

function HighlightVerseText({ item }: { item: SavedHighlight }) {
  const book = findBook(item.bookId);
  const { data } = useQuery({
    // The same key as the chapter screen, so a chapter already read is not fetched again.
    queryKey: ["chapter", item.translation, item.bookId, String(item.chapter)],
    queryFn: () =>
      bibleService.getChapter(
        { bookId: item.bookId, bookName: book?.name ?? item.bookId, chapter: item.chapter },
        item.translation,
      ),
    enabled: Boolean(book),
    staleTime: 5 * 60_000,
  });
  const text = data?.verses.find((verse) => verse.verse === item.verse)?.text;
  const tone = toneInfo(item.color);
  if (!text) {
    return (
      <span
        className={cn("block h-4 w-3/4 animate-pulse rounded", tone.tint)}
        aria-hidden={data ? undefined : true}
      />
    );
  }
  return (
    <p
      className={cn(
        "rounded-xl px-3 py-2 font-display text-[15px] leading-relaxed text-brand-text",
        tone.tint,
      )}
    >
      “{text}”
    </p>
  );
}

function HighlightCard({ item, notes }: { item: SavedHighlight; notes: Reflection[] }) {
  const reference = verseReference(item);
  const tone = toneInfo(item.color);
  const linked = notesOnVerse(notes, item);
  return (
    <li className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <Link
          to="/verse/$translation/$book/$chapter/$verse"
          params={verseParams(item)}
          className="min-w-0 rounded-sm text-base font-bold text-brand-text hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          {reference}
        </Link>
        <span className={EDITION_CHIP}>{item.translation}</span>
      </div>
      <div className="mt-2">
        <HighlightVerseText item={item} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn(META, "inline-flex items-center gap-1.5")}>
          <span className={cn("h-2.5 w-2.5 rounded-full", tone.swatch)} aria-hidden />
          {tone.name}
        </span>
        <span className={META}>Highlighted {relativeTime(item.at)}</span>
        {linked.length > 0 ? (
          <Link
            to="/reflect/$translation/$book/$chapter/$verse"
            params={verseParams(linked[0]!)}
            className="inline-flex min-h-8 items-center gap-1 rounded-full bg-brand-primary-soft px-2.5 text-xs font-semibold text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            <EditNoteIcon className="h-3.5 w-3.5" aria-hidden />
            {linked.length === 1 ? "1 related note" : `${linked.length} related notes`}
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ReadInChapter item={item} label="Read in Chapter Context" />
      </div>
    </li>
  );
}

export function SavedHighlightsHub({
  items,
  total,
  query,
  colour,
  colours,
  onColour,
  notes,
  loading,
  failed,
  sortLabel,
}: {
  items: SavedHighlight[];
  total: number;
  query: string;
  colour: string;
  colours: readonly ChipOption[];
  onColour: (id: string) => void;
  notes: Reflection[];
  loading: boolean;
  failed: boolean;
  sortLabel: string;
}) {
  return (
    <section aria-label="Highlights">
      {colours.length > 1 ? (
        <FilterChips
          label="Filter by highlight colour"
          options={colours}
          value={colour}
          onChange={onColour}
        />
      ) : null}
      <SectionLine title={`All Highlights (${total})`} sortLabel={sortLabel} />
      {loading ? (
        <ListSkeleton label="Loading highlights" />
      ) : failed ? (
        <Message>Couldn’t load your highlights. Check your connection and try again.</Message>
      ) : items.length === 0 ? (
        <Message>
          {query.trim()
            ? `No highlights match “${query.trim()}”.`
            : total === 0
              ? "No highlights yet. In a chapter, press and hold a verse, then choose a colour."
              : "No highlights in this colour."}
        </Message>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <HighlightCard
              key={`${item.translation}/${item.bookId}/${item.chapter}/${item.verse}`}
              item={item}
              notes={notes}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Notes (31) ---------- */

function NoteCard({ item, notebook }: { item: Reflection; notebook: string | undefined }) {
  const reference = verseReference(item);
  const title = item.title.trim();
  const excerpt = plainNote(item.body).trim();
  return (
    <li className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-bold text-brand-text">{reference}</h3>
        <span className={EDITION_CHIP}>{item.translation}</span>
      </div>
      {title ? <p className="mt-2 text-[15px] font-semibold text-brand-text">{title}</p> : null}
      {excerpt ? (
        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-brand-text-muted">{excerpt}</p>
      ) : null}
      {item.tags.length > 0 ? (
        <ul aria-label="Tags" className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-brand-surface-muted px-2.5 py-1 text-xs text-brand-text-muted"
            >
              #{tag}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={cn(META, "min-w-0 truncate")}>
          {[notebook, `Updated ${relativeTime(item.updatedAt)}`, item.isPrivate ? "Private" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Link
          to="/reflect/$translation/$book/$chapter/$verse"
          params={verseParams(item)}
          className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-full px-2 text-[13px] font-semibold text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          Open Note
          <ChevronRightIcon className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </li>
  );
}

export function SavedNotesHub({
  items,
  total,
  query,
  tag,
  tags,
  onTag,
  notebookName,
  loading,
  failed,
  sortLabel,
}: {
  items: Reflection[];
  total: number;
  query: string;
  tag: string;
  tags: readonly ChipOption[];
  onTag: (id: string) => void;
  notebookName: (id: string) => string | undefined;
  loading: boolean;
  failed: boolean;
  sortLabel: string;
}) {
  return (
    <section aria-label="Notes and reflections">
      {tags.length > 1 ? (
        <FilterChips label="Filter notes by tag" options={tags} value={tag} onChange={onTag} />
      ) : null}
      <SectionLine title="Recent Journal Entries" sortLabel={sortLabel} />
      {loading ? (
        <ListSkeleton label="Loading reflections" />
      ) : failed ? (
        <Message>Couldn’t load your reflections. Check your connection and try again.</Message>
      ) : items.length === 0 ? (
        <Message>
          {query.trim()
            ? `No reflections match “${query.trim()}”.`
            : total === 0
              ? "No reflections yet. Open a verse and choose Add Reflection."
              : "No reflections match this filter."}
        </Message>
      ) : (
        <ul aria-label="Reflections" className="flex flex-col gap-3">
          {items.map((item) => (
            <NoteCard key={item.id} item={item} notebook={notebookName(item.notebookId)} />
          ))}
        </ul>
      )}
    </section>
  );
}
