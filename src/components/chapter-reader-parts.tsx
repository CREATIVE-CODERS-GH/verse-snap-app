import { useEffect, useRef, type ReactNode, type Ref } from "react";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PersonIcon,
} from "@/components/stitch-icons";
import { LONG_PRESS_MOVE_PX, LONG_PRESS_MS } from "@/lib/verse-selection";

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
  /**
   * The first verse of the chapter opens with the chapter number as a large drop cap (rendered by
   * the page as a link to the verse), and its own small verse number is left out.
   */
  dropCapNode?: ReactNode;
  onSelect: () => void;
  /** The verse number, rendered as a link by the page so it keeps opening the verse view. */
  numberNode: ReactNode;
  /** Another verse is selected: this one is dimmed and inactive (Stitch 23). */
  dimmed?: boolean;
  /** Tapped once: shown with the selection bar and card, but the options sheet is not open yet. */
  marked?: boolean;
  /** Background class for a highlighted verse (saved, or chosen in this visit). */
  tint?: string | null;
  /** The selected verse's floating toolbar. */
  toolbar?: ReactNode;
  /** The row under the selected verse ("Active selection: v.2 …"). */
  selectionFooter?: ReactNode;
  /** The saved-reflection icon, shown after the verse number. */
  noteNode?: ReactNode;
  /**
   * Choosing several verses: a long press (touch) or Ctrl/Cmd-click or Shift+Enter starts it; once
   * `active`, a tap on any verse is handled by `onSelect` (the page toggles it).
   */
  multi?: { active: boolean; chosen: boolean; onStart: () => void };
}

export function VerseBlock({
  number,
  text,
  selected,
  dropCapNode,
  onSelect,
  numberNode,
  dimmed,
  marked,
  tint,
  toolbar,
  selectionFooter,
  noteNode,
  multi,
}: VerseBlockProps) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const startedAt = useRef(0);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  const chosen = Boolean(multi?.active && multi.chosen);

  const bar = (
    <div className="absolute bottom-0 left-0 top-0 w-1.5 rounded-l-xl bg-ch-primary" aria-hidden />
  );
  const body = (
    <p className="relative">
      {dropCapNode ?? numberNode}
      {noteNode}
      {chosen ? <span className="sr-only">(selected) </span> : null}
      {text}
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
      {...(chosen ? { "data-multi-chosen": "true" } : {})}
      onPointerDown={(event) => {
        // A finger resting on the verse (not on its links or buttons) starts choosing several.
        if (!multi || multi.active || event.pointerType === "mouse") return;
        if ((event.target as HTMLElement).closest("a, button")) return;
        cancelPress();
        const timer = window.setTimeout(() => {
          press.current = null;
          startedAt.current = Date.now();
          window.getSelection()?.removeAllRanges();
          multi.onStart();
        }, LONG_PRESS_MS);
        press.current = { timer, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_PX
        ) {
          cancelPress();
        }
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(event) => {
        // The long press that just started choosing must not also open the phone's text menu.
        if (Date.now() - startedAt.current < 1000) event.preventDefault();
      }}
      onClick={(event) => {
        // The lift that ends a long press is not a tap.
        if (Date.now() - startedAt.current < 700) return;
        if (multi && !multi.active && (event.ctrlKey || event.metaKey)) {
          multi.onStart();
          return;
        }
        // Dragging to select text also ends in a click; do not treat that as choosing the verse.
        if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
        onSelect();
      }}
      onKeyDown={(event) => {
        // Enter or Space on the verse itself (not on its number link) chooses it; with Shift it
        // starts choosing several.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (multi && !multi.active && event.shiftKey) multi.onStart();
          else onSelect();
        }
      }}
      className={`-mx-3 cursor-pointer touch-manipulation rounded-[3rem] p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary ${dimmed ? "pointer-events-none select-none opacity-35" : ""} ${marked || chosen ? `relative overflow-hidden shadow-sm ${tint ?? "bg-ch-container-low"}` : (tint ?? "hover:bg-ch-container-low/60")}`}
    >
      {marked || chosen ? (
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

/** The chapter number set as a drop cap at the start of the first verse. */
export const CHAPTER_DROP_CAP_CLASS =
  "float-left mr-3 mt-1.5 select-none rounded-md font-display text-[3.25rem] font-semibold leading-[0.85] text-ch-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary";

export const VERSE_NUMBER_CLASS =
  "relative mr-1 select-none text-xs font-semibold leading-4 text-brand-text-faint font-sans after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary";

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
