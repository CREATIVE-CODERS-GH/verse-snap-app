import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { SampleBadge } from "@/components/chapter-reader-parts";
import {
  BookmarkIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CompareArrowsIcon,
  CopyDocIcon,
  EraserIcon,
  HubIcon,
  PlayIcon,
  ShareNodesIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import type { SampleCrossReference } from "@/lib/bible/verse-annotation-sample";

/*
 * Presentational pieces of the verse selection and annotation experience (Stitch
 * "23 — In-Text Verse Selection & Annotation"), in the cooler --ch-* palette. They hold no data
 * fetching or app logic, so each action can be connected independently.
 */

export type Tone = "amber" | "sage" | "sky" | "rose" | "lilac" | "clear";

export interface ToneInfo {
  id: Tone;
  label: string;
  /** The colour name, shown as a tooltip ("Warm Ochre"). */
  name: string;
  swatch: string;
  /** Background of a highlighted verse. */
  tint: string;
  /** Hover dot inside the swatch. */
  dot: string;
}

// Highlight tones use the dedicated --hl-* tokens so they stay distinct from the brand palette.
export const TONES: readonly ToneInfo[] = [
  {
    id: "amber",
    label: "Amber",
    name: "Warm Ochre",
    swatch: "bg-hl-amber",
    tint: "bg-hl-amber/70",
    dot: "bg-hl-amber-ink",
  },
  {
    id: "sage",
    label: "Sage",
    name: "Soft Sage",
    swatch: "bg-hl-sage",
    tint: "bg-hl-sage/70",
    dot: "bg-hl-sage-ink",
  },
  {
    id: "sky",
    label: "Sky",
    name: "Clear Sky",
    swatch: "bg-hl-sky",
    tint: "bg-hl-sky/70",
    dot: "bg-hl-sky-ink",
  },
  {
    id: "rose",
    label: "Rose",
    name: "Dusty Rose",
    swatch: "bg-hl-rose",
    tint: "bg-hl-rose/70",
    dot: "bg-hl-rose-ink",
  },
  {
    id: "lilac",
    label: "Lilac",
    name: "Quiet Lilac",
    swatch: "bg-hl-lilac",
    tint: "bg-hl-lilac/70",
    dot: "bg-hl-lilac-ink",
  },
  {
    id: "clear",
    label: "Clear",
    name: "No highlight",
    swatch: "bg-hl-clear",
    tint: "bg-ch-container-low",
    dot: "bg-brand-icon-muted",
  },
];

export function toneInfo(tone: Tone): ToneInfo {
  return TONES.find((item) => item.id === tone) ?? TONES[0]!;
}

/** The floating Copy · Compare · Share toolbar that sits above the selected verse. */
export function SelectionToolbar({
  onCopy,
  onCompare,
  onShare,
}: {
  onCopy: () => void;
  onCompare: () => void;
  onShare: () => void;
}) {
  const button =
    "flex items-center gap-1.5 rounded-full px-2 py-1 text-ch-inverse-on-surface transition-all hover:bg-ch-container-highest/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-on-primary-container active:scale-95";
  return (
    <div
      role="toolbar"
      aria-label="Verse actions"
      className="absolute -top-12 left-1/2 z-20 flex animate-bounce-subtle items-center gap-2 whitespace-nowrap rounded-full bg-ch-inverse-surface px-3 py-1.5 text-ch-inverse-on-surface shadow-xl"
    >
      <button type="button" onClick={onCopy} className={button}>
        <CopyDocIcon className="h-[17px] w-[17px] text-ch-primary-fixed" aria-hidden />
        <span className="text-[11px] font-medium leading-[14px]">Copy</span>
      </button>
      <span className="h-3 w-px bg-ch-outline/40" aria-hidden />
      <button type="button" onClick={onCompare} className={button}>
        <CompareArrowsIcon className="h-[17px] w-[17px] text-ch-secondary-fixed" aria-hidden />
        <span className="text-[11px] font-medium leading-[14px]">Compare</span>
      </button>
      <span className="h-3 w-px bg-ch-outline/40" aria-hidden />
      <button type="button" onClick={onShare} className={button}>
        <ShareNodesIcon className="h-[17px] w-[17px] text-ch-tertiary-fixed" aria-hidden />
        <span className="text-[11px] font-medium leading-[14px]">Share</span>
      </button>
      <div
        className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-ch-inverse-surface"
        aria-hidden
      />
    </div>
  );
}

/** How far (px) a swipe must travel before the sheet expands, collapses or closes. */
const SWIPE_UP = 40;
const SWIPE_DOWN = 70;

/**
 * The bottom sheet frame: handle, header with the reference and the audio and close buttons.
 *
 * It opens as a small "peek" (header plus `peek` content) so the verse stays readable on phones.
 * Swiping up, or tapping the handle or the "Swipe up" hint, expands it to show `children`.
 * Swiping down collapses an expanded sheet, or closes a collapsed one.
 */
export function AnnotationSheet({
  reference,
  referenceNode,
  editionLine,
  speaking,
  onToggleListen,
  onClose,
  expanded,
  onExpandedChange,
  peek,
  collapsedExtra,
  closeButtonRef,
  sheetRef,
  children,
}: {
  reference: string;
  /** The reference title; the page wraps it in a link to the single-verse reader. */
  referenceNode?: ReactNode;
  editionLine: string;
  speaking: boolean;
  onToggleListen: () => void;
  onClose: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Always shown under the header (the highlight colours). */
  peek: ReactNode;
  /** Shown under the peek while collapsed (quick actions); hidden once expanded. */
  collapsedExtra?: ReactNode;
  closeButtonRef?: Ref<HTMLButtonElement>;
  sheetRef?: Ref<HTMLElement>;
  /** The rest of the options, shown once the sheet is expanded. */
  children: ReactNode;
}) {
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  // A swipe ends with a click on whatever is under the finger; that click must not also act.
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState(0);

  // Collapsed, the whole sheet responds to swipes; expanded, only the handle and header do, so
  // the options list can still scroll.
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (expanded && !(event.target as HTMLElement).closest("[data-sheet-grab]")) return;
    drag.current = { y: event.clientY, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const delta = event.clientY - state.y;
    if (!state.moved && Math.abs(delta) > 8) {
      state.moved = true;
      // From here it is a swipe, not a tap: keep the pointer so buttons don't fire.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (state.moved) setOffset(delta > 0 ? delta : Math.max(delta, -60) / 2);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    drag.current = null;
    setOffset(0);
    if (!state?.moved) return;
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    const delta = event.clientY - state.y;
    if (delta < -SWIPE_UP) onExpandedChange(true);
    else if (delta > SWIPE_DOWN) {
      if (expanded) onExpandedChange(false);
      else onClose();
    }
  };

  return (
    <aside
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Options for ${reference}`}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
      className={`fixed inset-x-0 bottom-0 z-[45] mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-t-[2rem] bg-ch-container-lowest font-stitch text-ch-on-surface shadow-2xl focus:outline-none ${offset ? "" : "transition-transform duration-300"} ${expanded ? "max-h-[min(724px,85dvh)]" : "max-h-[85dvh] touch-none select-none"}`}
    >
      <div data-sheet-grab className="touch-none select-none">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer options" : "Show more options"}
          onClick={() => onExpandedChange(!expanded)}
          className="flex w-full items-center justify-center pb-1.5 pt-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ch-primary"
        >
          <span className="h-1 w-10 rounded-full bg-ch-outline/40" aria-hidden />
        </button>
        <div className="flex items-center justify-between border-b border-ch-container/60 px-5 pb-2 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ch-container text-ch-primary">
              <BookOpenIcon className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-xl font-semibold leading-tight text-ch-on-surface">
                {referenceNode ?? reference}
              </h3>
              <p className="truncate text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
                {editionLine}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label={speaking ? "Stop listening" : "Listen to this verse"}
              aria-pressed={speaking}
              onClick={onToggleListen}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ch-container-low text-ch-primary transition-colors hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
            >
              {speaking ? (
                <StopSquareIcon className="h-5 w-5" aria-hidden />
              ) : (
                <VolumeIcon className="h-5 w-5" aria-hidden />
              )}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close sheet"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ch-container-low text-ch-on-surface-variant transition-colors hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
            >
              <CloseIcon className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div
        className={`no-scrollbar flex flex-col px-5 ${expanded ? "gap-4 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3" : "gap-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5"}`}
      >
        {peek}
        {expanded ? (
          children
        ) : (
          <>
            {collapsedExtra}
            <button
              type="button"
              onClick={() => onExpandedChange(true)}
              className="mx-auto flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-semibold leading-[14px] text-ch-on-surface-variant transition-colors hover:bg-ch-container-low hover:text-ch-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
            >
              <ChevronUpIcon className="h-4 w-4 animate-bounce" aria-hidden />
              Swipe up for more options
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

/** One-row shortcuts shown while the sheet is collapsed: Listen, Save, Copy and Compare. */
export function QuickActions({
  speaking,
  onToggleListen,
  saved,
  saveDisabled,
  onToggleSave,
  onCopy,
  onCompare,
}: {
  speaking: boolean;
  onToggleListen: () => void;
  saved: boolean;
  saveDisabled?: boolean;
  onToggleSave: () => void;
  onCopy: () => void;
  onCompare: () => void;
}) {
  const item =
    "flex items-center justify-center gap-1.5 rounded-full bg-ch-container-low py-2 text-ch-on-surface transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95 disabled:opacity-60";
  const label = "text-[11px] font-semibold leading-[14px]";
  return (
    <div role="group" aria-label="Quick actions" className="grid grid-cols-4 gap-2">
      <button type="button" aria-pressed={speaking} onClick={onToggleListen} className={item}>
        {speaking ? (
          <StopSquareIcon className="h-[18px] w-[18px] text-ch-primary" aria-hidden />
        ) : (
          <PlayIcon className="h-[18px] w-[18px] text-ch-primary" aria-hidden />
        )}
        <span className={label}>{speaking ? "Stop" : "Listen"}</span>
      </button>
      <button
        type="button"
        aria-pressed={saved}
        disabled={saveDisabled}
        onClick={onToggleSave}
        className={item}
      >
        <BookmarkIcon className="h-[18px] w-[18px] text-ch-primary" filled={saved} aria-hidden />
        <span className={label}>{saved ? "Saved" : "Save"}</span>
      </button>
      <button type="button" onClick={onCopy} className={item}>
        <CopyDocIcon className="h-[18px] w-[18px] text-ch-secondary" aria-hidden />
        <span className={label}>Copy</span>
      </button>
      <button type="button" onClick={onCompare} className={item}>
        <CompareArrowsIcon className="h-[18px] w-[18px] text-ch-tertiary" aria-hidden />
        <span className={label}>Compare</span>
      </button>
    </div>
  );
}

/** The six highlight swatches in one compact row (names are kept for screen readers and tooltips). */
export function HighlightPicker({
  active,
  onChange,
}: {
  /** The chosen colour; null when none is (for example several verses with different colours). */
  active: Tone | null;
  onChange: (tone: Tone) => void;
}) {
  return (
    <section aria-label="Highlight tone" className="rounded-2xl bg-ch-container-low px-3 py-2.5">
      <div
        role="radiogroup"
        aria-label="Highlight colour"
        className="flex items-center justify-between gap-2"
      >
        {TONES.map((tone) => {
          const selected = tone.id === active;
          return (
            <button
              key={tone.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={tone.id === "clear" ? "Clear highlight" : `${tone.label} highlight`}
              title={tone.id === "clear" ? "Clear highlight" : tone.name}
              onClick={() => onChange(tone.id)}
              className="group flex items-center justify-center focus:outline-none"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full shadow-xs transition-transform group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-ch-primary group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-ch-container-low group-active:scale-95 ${tone.swatch} ${selected ? "ring-2 ring-ch-primary ring-offset-2 ring-offset-ch-container-low" : ""} ${tone.id === "clear" ? "text-ch-outline hover:text-ch-error" : ""}`}
              >
                {tone.id === "clear" ? (
                  <EraserIcon className="h-[17px] w-[17px]" aria-hidden />
                ) : selected ? (
                  <CheckIcon
                    className="h-[17px] w-[17px] text-ch-on-secondary-container"
                    aria-hidden
                  />
                ) : (
                  <span
                    className={`h-2.5 w-2.5 rounded-full opacity-0 transition-opacity group-hover:opacity-100 ${tone.dot}`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One of the four action tiles (Bookmark Verse, Add Reflection, Verse Card, Compare). */
export function ActionTile({
  icon,
  iconClass,
  badge,
  badgeClass,
  chevron,
  title,
  subtitle,
  onClick,
  pressed,
  disabled,
}: {
  icon: ReactNode;
  iconClass: string;
  badge?: string | null;
  badgeClass?: string;
  chevron?: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className="flex h-24 flex-col justify-between rounded-2xl border border-ch-container/50 bg-ch-container-low p-3 text-left transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-[0.98] disabled:opacity-60"
    >
      <span className="flex w-full items-center justify-between">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full bg-ch-container-lowest shadow-xs ${iconClass}`}
          aria-hidden
        >
          {icon}
        </span>
        {badge ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-[14px] ${badgeClass ?? ""}`}
          >
            {badge}
          </span>
        ) : chevron ? (
          <ChevronRightIcon className="h-[18px] w-[18px] text-ch-outline" aria-hidden />
        ) : null}
      </span>
      <span className="block min-w-0">
        <span className="block text-[13px] font-semibold leading-snug text-ch-on-surface">
          {title}
        </span>
        <span className="block truncate text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

/** "Spoken Contemplation" card with the play button and the Listen pill. */
export function SpokenCard({
  speaking,
  onToggle,
  subtitle,
}: {
  speaking: boolean;
  onToggle: () => void;
  subtitle: string;
}) {
  return (
    <section
      aria-label="Spoken contemplation"
      className="flex items-center justify-between gap-3 rounded-2xl border border-ch-container/50 bg-ch-container-low p-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label={speaking ? "Stop Spoken Contemplation" : "Play Spoken Contemplation"}
          aria-pressed={speaking}
          onClick={onToggle}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ch-primary text-ch-on-primary shadow-md transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2 active:scale-95"
        >
          {speaking ? (
            <StopSquareIcon className="h-6 w-6" aria-hidden />
          ) : (
            <PlayIcon className="h-6 w-6" aria-hidden />
          )}
        </button>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-[18px] text-ch-on-surface">
            Spoken Contemplation
          </div>
          <div className="truncate text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
            {subtitle}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 rounded-full bg-ch-container px-3 py-1.5 text-[11px] font-semibold leading-[14px] tracking-wide text-ch-primary transition-all hover:bg-ch-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95"
      >
        {speaking ? "Stop" : "Listen"}
      </button>
    </section>
  );
}

const DOT: Record<SampleCrossReference["dot"], string> = {
  primary: "bg-ch-primary",
  secondary: "bg-ch-secondary",
  tertiary: "bg-ch-tertiary",
};

const CHIP =
  "flex shrink-0 items-center gap-1.5 rounded-full border border-ch-container/60 bg-ch-container-low px-3 py-1.5 text-ch-on-surface transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95";

export const CROSS_REF_CHIP_CLASS = CHIP;

export function CrossRefChipContent({ chip }: { chip: SampleCrossReference }) {
  return (
    <>
      <span className={`h-2 w-2 rounded-full ${DOT[chip.dot]}`} aria-hidden />
      <span className="text-[11px] font-semibold leading-[14px]">{chip.label}</span>
      <span className="text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
        {chip.hint}
      </span>
    </>
  );
}

/** "Thematic Cross References" with the chip row. `chipNode` lets the page render real links. */
export function CrossReferenceSection({
  total,
  chips,
  onExploreAll,
  chipNode,
}: {
  total: number;
  chips: readonly SampleCrossReference[];
  onExploreAll: () => void;
  chipNode: (chip: SampleCrossReference, index: number) => ReactNode;
}) {
  return (
    <section aria-label="Thematic cross references" className="flex flex-col gap-2 pb-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-[14px] tracking-wider text-ch-on-surface-variant">
          <HubIcon className="h-4 w-4 text-ch-primary" aria-hidden />
          Thematic Cross References
          <SampleBadge />
        </span>
        <button
          type="button"
          onClick={onExploreAll}
          className="shrink-0 text-[11px] font-semibold leading-[14px] text-ch-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
        >
          Explore all ({total})
        </button>
      </div>
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-1">
        {chips.map((chip, index) => chipNode(chip, index))}
      </div>
    </section>
  );
}

/** The row under the selected verse: "Active selection: v.2" and the preview highlight note. */
export function SelectionFooter({
  verse,
  highlightText,
}: {
  verse: number;
  highlightText: string;
}) {
  return (
    <div className="mt-2 flex items-center justify-between pl-2 text-ch-secondary">
      <span className="flex items-center gap-1 text-[11px] font-semibold leading-[14px] tracking-wider">
        <BookmarkIcon className="h-[15px] w-[15px]" filled aria-hidden />
        Active selection: v.{verse}
      </span>
      <span className="text-[11px] font-medium leading-[14px] opacity-70">{highlightText}</span>
    </div>
  );
}
