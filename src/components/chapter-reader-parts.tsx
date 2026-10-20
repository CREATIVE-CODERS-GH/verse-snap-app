import type { ReactNode, Ref } from "react";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PersonIcon,
} from "@/components/stitch-icons";

/*
 * Presentational pieces of the chapter reader (Stitch "22 — Continuous Chapter Reading"), using the
 * cooler --ch-* palette that screen specifies. They hold no data fetching or app logic, so each can be
 * connected to real features later.
 */

/** Marks demonstration content that has no real source yet. */
export function SampleBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-ch-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-ch-on-secondary-container ${className}`}
    >
      Sample content
    </span>
  );
}

interface TopBarProps {
  translation: string;
  onBack: () => void;
  onOpenTranslations: () => void;
  /** The "Scripture Reader" dropdown (a menu supplied by the page). */
  readerMenu: ReactNode;
  /** The account avatar (a link supplied by the page). */
  avatar: ReactNode;
  translationButtonRef?: Ref<HTMLButtonElement>;
}

export function ChapterTopBar({
  translation,
  onBack,
  onOpenTranslations,
  readerMenu,
  avatar,
  translationButtonRef,
}: TopBarProps) {
  return (
    <header className="fixed top-0 z-50 w-full bg-ch-surface/80 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Go back"
            onClick={onBack}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ch-on-surface-variant transition-colors hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:bg-ch-container"
          >
            <ArrowLeftIcon className="h-6 w-6" strokeWidth={1.8} />
          </button>
          {readerMenu}
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={translationButtonRef}
            type="button"
            aria-haspopup="dialog"
            aria-label={`Bible translation: ${translation}. Change translation`}
            onClick={onOpenTranslations}
            className="rounded-full bg-ch-container px-3 py-1 text-[11px] font-semibold leading-[14px] tracking-wider text-ch-primary transition-colors hover:bg-ch-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
          >
            {translation}
          </button>
          {avatar}
        </div>
      </div>
    </header>
  );
}

/** The "Scripture Reader ▾" button face (wrapped by a dropdown trigger in the page). */
export const READER_MENU_BUTTON_CLASS =
  "flex items-center gap-1 rounded-full px-3 py-1.5 transition-colors hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:bg-ch-container-high";

export function ReaderMenuLabel() {
  return (
    <>
      <span className="text-left font-display text-xl font-medium leading-none text-ch-on-surface">
        Scripture Reader
      </span>
      <ChevronDownIcon className="h-5 w-5 text-ch-on-surface-variant" aria-hidden />
    </>
  );
}

export const AVATAR_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full bg-ch-primary text-ch-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2";

export function AvatarIcon() {
  return <PersonIcon className="h-[18px] w-[18px]" />;
}

interface ControlsProps {
  chapterLabel: string;
  translation: string;
  onOpenChapters: () => void;
  /** Opens the translation sheet from the edition badge (the page has no top header). */
  onOpenTranslations?: (() => void) | undefined;
  onOpenTextSize: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  progress: number;
  chapterButtonRef?: Ref<HTMLButtonElement>;
  textSizeButtonRef?: Ref<HTMLButtonElement>;
  translationButtonRef?: Ref<HTMLButtonElement>;
}

/** Sticky chapter selector, Aa and bookmark controls, with the reading-progress bar under them. */
export function ChapterControls({
  chapterLabel,
  translation,
  onOpenChapters,
  onOpenTranslations,
  onOpenTextSize,
  bookmarked,
  onToggleBookmark,
  progress,
  chapterButtonRef,
  textSizeButtonRef,
  translationButtonRef,
}: ControlsProps) {
  const badge =
    "rounded-full bg-ch-container-highest px-1.5 py-0.5 text-[11px] font-bold leading-[14px] tracking-wider text-ch-primary";
  return (
    <div className="sticky top-0 z-30 w-full">
      <aside
        aria-label="Reading Controls"
        className="flex w-full items-center justify-between bg-ch-container-lowest/90 px-5 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] shadow-sm backdrop-blur-md"
      >
        <div className="flex items-center gap-1.5">
          <button
            ref={chapterButtonRef}
            type="button"
            aria-label={`${chapterLabel}. Open the book and chapter index`}
            onClick={onOpenChapters}
            className="flex items-center gap-1 rounded-full bg-ch-container-low px-2.5 py-1 transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95"
          >
            <span className="text-[13px] font-semibold leading-[18px] text-ch-on-surface">
              {chapterLabel}
            </span>
            <ChevronDownIcon className="h-4 w-4 text-ch-on-surface-variant" aria-hidden />
            {onOpenTranslations ? null : <span className={`ml-1 ${badge}`}>{translation}</span>}
          </button>
          {onOpenTranslations ? (
            <button
              ref={translationButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Bible translation: ${translation}. Change translation`}
              onClick={onOpenTranslations}
              className={`${badge} transition-all hover:bg-ch-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95`}
            >
              {translation}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            ref={textSizeButtonRef}
            type="button"
            aria-haspopup="dialog"
            aria-label="Reading font and size settings"
            onClick={onOpenTextSize}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-ch-on-surface-variant transition-all after:absolute after:-inset-1 after:content-[''] hover:bg-ch-container hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-90"
          >
            <span className="font-display text-base font-bold tracking-tighter">Aa</span>
          </button>
          <button
            type="button"
            aria-label="Bookmark this chapter"
            aria-pressed={bookmarked}
            onClick={onToggleBookmark}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-all after:absolute after:-inset-1 after:content-[''] hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-90 ${bookmarked ? "text-ch-secondary" : "text-ch-on-surface-variant hover:text-ch-secondary"}`}
          >
            <BookmarkIcon className="h-5 w-5" filled={bookmarked} />
          </button>
        </div>
      </aside>
      <div
        className="h-[3px] w-full bg-ch-container-high"
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full bg-ch-primary transition-all duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export function ChapterHeading({ chapter }: { chapter: number }) {
  return (
    <header className="flex flex-col items-center pb-6 text-center">
      <h1 className="font-display text-[28px] font-semibold leading-9 tracking-tight text-ch-on-surface">
        Chapter {chapter}
      </h1>
    </header>
  );
}

interface VerseBlockProps {
  number: number;
  text: string;
  selected: boolean;
  /** Show a large first letter (the first verse of the chapter). */
  dropCap?: boolean;
  onSelect: () => void;
  /** The verse number, rendered as a link by the page so it keeps opening the verse view. */
  numberNode: ReactNode;
  /** Another verse is selected: this one is dimmed and inactive (Stitch 23). */
  dimmed?: boolean;
  /** Tapped once: shown with the selection bar and card, but the options sheet is not open yet. */
  marked?: boolean;
  /** Background class for a highlighted verse (a preview highlight, not saved). */
  tint?: string | null;
  /** The selected verse's floating toolbar. */
  toolbar?: ReactNode;
  /** The row under the selected verse ("Active selection: v.2 …"). */
  selectionFooter?: ReactNode;
}

export function VerseBlock({
  number,
  text,
  selected,
  dropCap,
  onSelect,
  numberNode,
  dimmed,
  marked,
  tint,
  toolbar,
  selectionFooter,
}: VerseBlockProps) {
  const bar = (
    <div className="absolute bottom-0 left-0 top-0 w-1.5 rounded-l-xl bg-ch-primary" aria-hidden />
  );
  const letters = Array.from(text);
  const first = dropCap ? (letters[0] ?? "") : "";
  const rest = dropCap ? letters.slice(1).join("") : text;
  const body = (
    <p className="relative">
      {first ? (
        <span
          aria-hidden
          className="float-left pr-3 pt-1 font-display text-4xl font-semibold leading-none text-ch-primary"
        >
          {first}
        </span>
      ) : null}
      {numberNode}
      {first ? <span className="sr-only">{first}</span> : null}
      {rest}
    </p>
  );

  if (selected) {
    return (
      <div data-verse-block={number} data-selected="true" className="relative z-[35] -mx-3 my-1">
        {toolbar}
        <div
          className={`relative overflow-hidden rounded-[3rem] p-3 shadow-sm transition-all duration-300 ${tint ?? "bg-ch-container-low"}`}
        >
          {bar}
          <div className="pl-2 selection:bg-ch-secondary-container">{body}</div>
          {selectionFooter}
        </div>
      </div>
    );
  }

  return (
    <div
      data-verse-block={number}
      {...(marked ? { "data-marked": "true" } : {})}
      tabIndex={dimmed ? -1 : 0}
      {...(dimmed ? { inert: true } : {})}
      onClick={() => {
        // Dragging to select text also ends in a click; do not treat that as choosing the verse.
        if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
        onSelect();
      }}
      onKeyDown={(event) => {
        // Enter or Space on the verse itself (not on its number link) chooses it.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`-mx-3 cursor-pointer touch-manipulation rounded-[3rem] p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary ${dimmed ? "pointer-events-none select-none opacity-35" : ""} ${marked ? `relative overflow-hidden shadow-sm ${tint ?? "bg-ch-container-low"}` : (tint ?? "hover:bg-ch-container-low/60")}`}
    >
      {marked ? (
        <>
          {bar}
          <div className="pl-2">{body}</div>
        </>
      ) : (
        body
      )}
    </div>
  );
}

export const VERSE_NUMBER_CLASS =
  "relative mr-1 select-none text-xs font-semibold leading-4 text-ch-primary font-sans after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary";

export const FLOATING_NAV_BUTTON =
  "flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ch-container-low px-3 py-2 text-[13px] font-semibold leading-[18px] text-ch-on-surface shadow-xs transition-all select-none hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95";

/** Floating Previous / Next chapter pill. The page passes links (or disabled spans) for each side. */
export function FloatingChapterNav({ previous, next }: { previous: ReactNode; next: ReactNode }) {
  return (
    <nav
      aria-label="Chapter navigation"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md px-5"
    >
      <div className="pointer-events-auto mx-auto flex max-w-xs items-center justify-between gap-2 rounded-full border border-ch-container-high/60 bg-ch-container-lowest/95 p-2 shadow-xl backdrop-blur-xl">
        {previous}
        <div className="h-5 w-px bg-ch-container-high" aria-hidden />
        {next}
      </div>
    </nav>
  );
}

export function FloatingNavLabel({
  direction,
  label,
}: {
  direction: "previous" | "next";
  label: string;
}) {
  return (
    <>
      {direction === "previous" ? (
        <ChevronLeftIcon className="h-[18px] w-[18px] text-ch-outline" aria-hidden />
      ) : null}
      <span>{label}</span>
      {direction === "next" ? (
        <ChevronRightIcon className="h-[18px] w-[18px] text-ch-outline" aria-hidden />
      ) : null}
    </>
  );
}

/** Pill toast for bookmark and selection feedback. */
export function ChapterToast({
  message,
  visible,
  action,
  positionClass = "bottom-20",
}: {
  message: string;
  visible: boolean;
  action?: ReactNode;
  positionClass?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed ${positionClass} left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-ch-inverse-surface px-4 py-2 text-[13px] font-medium leading-[18px] text-ch-inverse-on-surface shadow-lg transition-all duration-300 ${visible ? (action ? "opacity-100" : "pointer-events-none opacity-100") : "pointer-events-none opacity-0"}`}
    >
      <CheckCircleIcon className="h-[18px] w-[18px] shrink-0 text-ch-on-primary-container" />
      <span>{visible ? message : ""}</span>
      {visible ? action : null}
    </div>
  );
}
