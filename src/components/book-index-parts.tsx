import type { Ref } from "react";
import {
  ArrowRightIcon,
  BookmarkIcon,
  ChevronUpIcon,
  ChevronRightIcon,
  CloseIcon,
  MicIcon,
  PlayIcon,
  SearchIcon,
} from "@/components/stitch-icons";
import type { BookGroup, Testament } from "@/lib/bible/book-groups";
import { TESTAMENT_LABEL } from "@/lib/bible/book-groups";
import { bookBadge } from "@/lib/bible/book-groups";
import type { BibleBook } from "@/lib/bible/books";

/*
 * Presentational pieces of the Book & Chapter Index (Stitch "21 — Book & Chapter Index"), in the same
 * cooler --ch-* palette as the chapter reader. No data fetching or app logic lives here.
 */

export function BookSearchField({
  value,
  onChange,
  onMic,
  listening,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onMic: () => void;
  listening: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div
      role="search"
      className="relative w-full rounded-full bg-ch-container-lowest shadow-sm focus-within:ring-2 focus-within:ring-ch-primary/40"
    >
      <div className="flex items-center px-3 py-2.5">
        <SearchIcon
          className="ml-1 mr-2 h-[22px] w-[22px] select-none text-ch-outline"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search books (e.g. Genesis, Romans)..."
          aria-label="Search books"
          autoComplete="off"
          enterKeyHint="search"
          className="w-full bg-transparent text-sm text-ch-on-surface placeholder:text-ch-outline focus:outline-none"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ch-outline transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-ch-container hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
          >
            <CloseIcon className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={listening ? "Stop voice search" : "Search books by voice"}
            aria-pressed={listening}
            onClick={onMic}
            className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-ch-container hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary ${listening ? "animate-pulse bg-ch-primary text-ch-on-primary" : "text-ch-outline"}`}
          >
            <MicIcon className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>
    </div>
  );
}

export function TestamentTabs({
  value,
  onChange,
  counts,
}: {
  value: Testament;
  onChange: (value: Testament) => void;
  counts: Record<Testament, number>;
}) {
  const tab = (testament: Testament) => {
    const active = value === testament;
    return (
      <button
        key={testament}
        type="button"
        role="tab"
        id={`tab-${testament}`}
        aria-selected={active}
        onClick={() => onChange(testament)}
        className={`flex-1 rounded-full py-2 text-center text-[13px] leading-[18px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary ${active ? "bg-ch-primary font-semibold text-ch-on-primary shadow-sm" : "font-medium text-ch-on-surface-variant hover:text-ch-on-surface"}`}
      >
        {TESTAMENT_LABEL[testament]} ({counts[testament]})
      </button>
    );
  };
  return (
    <div
      role="tablist"
      aria-label="Testament"
      className="flex w-full rounded-full bg-ch-container-high p-1"
    >
      {tab("ot")}
      {tab("nt")}
    </div>
  );
}

export function CategoryChips({
  groups,
  active,
  onChange,
}: {
  groups: readonly BookGroup[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Book categories"
      className="no-scrollbar -mx-5 flex items-center gap-1 overflow-x-auto px-5 py-0.5"
    >
      {groups.map((group) => {
        const isActive = group.id === active;
        return (
          <button
            key={group.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(group.id)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] leading-[14px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary ${isActive ? "bg-ch-primary font-semibold text-ch-on-primary" : "bg-ch-container-lowest font-medium text-ch-on-surface-variant hover:bg-ch-container"}`}
          >
            {isActive ? (
              <span className="h-1.5 w-1.5 rounded-full bg-ch-secondary-fixed" aria-hidden />
            ) : null}
            {group.label}
          </button>
        );
      })}
    </div>
  );
}

export function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-ch-secondary" aria-hidden />
        <h2 className="text-[13px] font-semibold uppercase leading-[18px] tracking-widest text-ch-secondary">
          {label}
        </h2>
      </div>
      <span className="text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
        {count} {count === 1 ? "Book" : "Books"}
      </span>
    </div>
  );
}

const CHAPTERS_PILL =
  "rounded-full bg-ch-container px-2.5 py-0.5 text-[11px] font-medium leading-[14px] text-ch-on-surface-variant";

interface BookCardProps {
  book: BibleBook;
  /** Chapter currently chosen in the grid (null when none). */
  selectedChapter: number | null;
  onSelectChapter: (chapter: number) => void;
  /** "Last read: …" text, or null when the book has not been read. */
  lastRead: string | null;
  /** Collapses the open book back into its row. */
  onClose: () => void;
}

/** The expanded book: its name, chapter count and chapter grid. The corner icon closes it. */
export function BookCard({
  book,
  selectedChapter,
  onSelectChapter,
  lastRead,
  onClose,
}: BookCardProps) {
  return (
    <section
      aria-label={book.name}
      className="rounded-[3rem] bg-ch-container-lowest p-6 shadow-md transition-all duration-300"
    >
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-display text-[22px] font-semibold leading-7 text-ch-on-surface">
            {book.name}
          </h3>
          <span className={CHAPTERS_PILL}>{book.chapters} Ch.</span>
        </div>
        <button
          type="button"
          aria-label={`Close ${book.name}`}
          aria-expanded={true}
          onClick={onClose}
          className={BOOK_ICON_BUTTON_CLASS}
        >
          <ChevronUpIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase leading-[14px] tracking-wider text-ch-outline">
            Select Chapter
          </span>
          <span
            className="text-[11px] font-medium leading-[14px] text-ch-primary"
            aria-live="polite"
          >
            {selectedChapter ? `Chapter ${selectedChapter} active` : null}
          </span>
        </div>
        <div
          role="group"
          aria-label={`${book.name} chapters`}
          className="grid grid-cols-4 gap-2.5 sm:grid-cols-8"
        >
          {Array.from({ length: book.chapters }, (_, index) => index + 1).map((number) => {
            const active = number === selectedChapter;
            return (
              <button
                key={number}
                type="button"
                aria-pressed={active}
                aria-label={`${book.name} chapter ${number}`}
                onClick={() => onSelectChapter(number)}
                className={`flex h-11 items-center justify-center rounded-[2rem] text-[13px] leading-[18px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2 ${active ? "scale-[1.03] bg-ch-primary font-bold text-ch-on-primary shadow-md" : "bg-ch-container-low font-medium text-ch-on-surface hover:bg-ch-container"}`}
              >
                {number}
              </button>
            );
          })}
        </div>
      </div>
      {lastRead ? (
        <div className="mt-4 flex items-center gap-1 pt-3 text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
          <BookmarkIcon className="h-4 w-4 text-ch-primary" aria-hidden />
          <span>{lastRead}</span>
        </div>
      ) : null}
    </section>
  );
}

/** The icon button in the card corner (closes the open book). */
const BOOK_ICON_BUTTON_CLASS =
  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ch-container text-ch-primary transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-ch-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary";

export function BookRow({
  book,
  kind,
  onSelect,
}: {
  book: BibleBook;
  kind: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={onSelect}
      className="flex w-full items-center justify-between rounded-[3rem] bg-ch-container-lowest p-4 text-left shadow-sm transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-[0.99]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ch-container text-[11px] font-semibold leading-[14px] text-ch-on-surface-variant">
          {bookBadge(book)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-xl font-medium leading-tight text-ch-on-surface">
            {book.name}
          </span>
          <span className="block text-xs leading-4 text-ch-on-surface-variant">{kind}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={CHAPTERS_PILL}>{book.chapters} Ch.</span>
        <ChevronRightIcon className="h-5 w-5 text-ch-outline" aria-hidden />
      </span>
    </button>
  );
}

/** Fixed bottom bar. The page renders it as a link to the chapter that will open. */
export const CONTINUE_BAR_OUTER =
  "pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-5";
export const CONTINUE_BAR_INNER =
  "pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full bg-ch-primary py-1.5 pl-1.5 pr-3.5 text-ch-on-primary shadow-lg shadow-ch-primary/20 transition-all hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2 active:scale-[0.97]";

export function ContinueBarContent({ label, target }: { label: string; target: string }) {
  return (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ch-on-primary/15">
        <PlayIcon className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-[11px] font-medium leading-none text-ch-on-primary/75">{label}</span>
        <span className="truncate text-[13px] font-semibold leading-none text-ch-on-primary">
          {target}
        </span>
      </span>
      <ArrowRightIcon className="h-4 w-4 shrink-0 text-ch-on-primary/90" aria-hidden />
    </>
  );
}
