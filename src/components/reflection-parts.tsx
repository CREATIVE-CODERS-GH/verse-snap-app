import type { ReactNode, Ref, RefObject } from "react";
import { SheetFrame } from "@/components/chapter-sheets";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  HeartIcon,
  ListBulletIcon,
  LockIcon,
  MicIcon,
  PagesIcon,
  PlusIcon,
  QuoteIcon,
  StopSquareIcon,
} from "@/components/stitch-icons";
import type { FormatKind } from "@/lib/reflection-format";

/*
 * Presentational pieces of the Reflection Journal (Stitch "24 — Verse Reflection & Note Journal"),
 * in the cooler --ch-* palette shared with the chapter reader. They hold no data fetching or app
 * logic; the route wires them up.
 */

const ICON_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-full text-ch-on-surface-variant transition-all hover:bg-ch-container-high/40 hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95";

export const CARD = "rounded-2xl bg-ch-container-lowest shadow-sm";
const SECTION_LABEL =
  "text-[11px] font-medium uppercase leading-[14px] tracking-wider text-ch-on-surface-variant";

/** Fixed header: back, title and the More menu. */
export function JournalHeader({ onBack, menu }: { onBack: () => void; menu: ReactNode }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-ch-surface/85 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            aria-label="Go back"
            onClick={onBack}
            className={`-ml-1 ${ICON_BUTTON}`}
          >
            <ArrowLeftIcon className="h-[22px] w-[22px]" />
          </button>
          <h1 className="truncate pr-2 font-display text-xl font-medium leading-7 text-ch-on-surface">
            Verse Reflection &amp; Note Journal
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">{menu}</div>
      </div>
    </header>
  );
}

export const MORE_BUTTON_CLASS = ICON_BUTTON;

/** The pinned reference card: edition chip, highlight chip, the verse and its theme. */
export function ReferenceCard({
  referenceLabel,
  highlight,
  verseText,
  theme,
  contextLink,
}: {
  /** "Romans 12:2 (KJAV)" */
  referenceLabel: string;
  /** "Warm Ochre" and its dot colour, when the verse was highlighted in the reader. */
  highlight: { name: string; dot: string } | null;
  verseText: ReactNode;
  /** The sample theme, or null when there is none for this verse. */
  theme: ReactNode;
  contextLink: ReactNode;
}) {
  return (
    <section
      aria-label="Scripture"
      className={`${CARD} relative flex flex-col gap-3 overflow-hidden p-4`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-ch-primary/10 px-3 py-1 text-[13px] font-medium leading-[18px] text-ch-primary">
          <BookOpenIcon className="h-4 w-4" aria-hidden />
          {referenceLabel}
        </span>
        {highlight ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ch-secondary-container/50 px-3 py-1 text-[11px] font-medium leading-[14px] text-ch-on-secondary-container">
            <span className={`h-2.5 w-2.5 rounded-full ${highlight.dot}`} aria-hidden />
            Highlight: {highlight.name}
          </span>
        ) : null}
      </div>
      <blockquote className="relative pl-2 font-display text-2xl italic leading-[38px] text-ch-on-surface">
        {verseText}
      </blockquote>
      <div className="flex items-center justify-between gap-3 pt-1 text-[11px] font-medium leading-[14px] text-ch-on-surface-variant">
        <span className="flex min-w-0 items-center gap-1">
          <PagesIcon className="h-[15px] w-[15px] shrink-0" aria-hidden />
          <span className="min-w-0">{theme}</span>
        </span>
        {contextLink}
      </div>
    </section>
  );
}

export const CONTEXT_LINK_CLASS =
  "flex shrink-0 items-center gap-0.5 rounded-sm text-[13px] font-medium leading-[18px] text-ch-primary transition-transform hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95";

export function ContextLinkLabel() {
  return (
    <>
      View Context
      <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
    </>
  );
}

/** The editor card's top row: the draft status dot and text, and the live word count. */
export function EditorStatus({
  status,
  editing,
  words,
}: {
  status: string;
  editing: boolean;
  words: string;
}) {
  return (
    <div className="flex items-center justify-between pb-1">
      <div
        className="flex items-center gap-1 text-[11px] font-medium leading-[14px] text-ch-on-surface-variant"
        role="status"
        aria-live="polite"
      >
        <span
          className={`h-2 w-2 rounded-full ${editing ? "animate-pulse bg-ch-primary-container" : "bg-ch-secondary"}`}
          aria-hidden
        />
        <span data-testid="draft-status">{status}</span>
      </div>
      <span
        className="text-[11px] font-medium leading-[14px] text-ch-on-surface-variant"
        aria-live="polite"
        data-testid="word-count"
      >
        {words}
      </span>
    </div>
  );
}

/** The "Spiritual Posture" row inside the editor card. */
export function PostureRow({
  label,
  onChange,
  buttonRef,
}: {
  label: string | null;
  onChange: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-ch-container-low/60 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ch-primary/10 text-ch-primary">
          <HeartIcon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-medium leading-[14px] text-ch-on-surface">
            Spiritual Posture
          </span>
          <span className="truncate text-xs leading-4 text-ch-on-surface-variant">
            {label ?? "How are you coming to this verse?"}
          </span>
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Change spiritual posture${label ? ` (currently ${label})` : ""}`}
        onClick={onChange}
        className="shrink-0 rounded-full bg-ch-container-lowest px-3 py-1 text-[11px] font-medium leading-[14px] text-ch-on-surface shadow-sm transition-all hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95"
      >
        {label ? "Change" : "Choose"}
      </button>
    </div>
  );
}

const TAG_BASE =
  "flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium leading-[18px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-1 active:scale-95";

/** "Topics & Tags": toggleable chips, plus the Add Tag control (a button or the inline field). */
export function TagsSection({
  tags,
  selected,
  onToggle,
  addControl,
}: {
  tags: readonly string[];
  selected: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  addControl: ReactNode;
}) {
  return (
    <section aria-labelledby="tags-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="tags-heading" className={SECTION_LABEL}>
          Topics &amp; Tags
        </h2>
        <span className="text-[11px] font-medium leading-[14px] text-ch-outline">
          Selected ({selected.size})
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => {
          const on = selected.has(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(tag)}
              className={`${TAG_BASE} ${on ? "bg-ch-primary text-ch-on-primary" : "bg-ch-container-high text-ch-on-surface"}`}
            >
              <span>{tag}</span>
              {on ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : null}
            </button>
          );
        })}
        {addControl}
      </div>
    </section>
  );
}

export const ADD_TAG_CLASS = `${TAG_BASE} bg-ch-container text-ch-primary`;

export function AddTagLabel() {
  return (
    <>
      <PlusIcon className="h-4 w-4" aria-hidden />
      <span>Add Tag</span>
    </>
  );
}

/** The organisation card: notebook selector and the private-note switch. */
export function OrganizationCard({
  notebookName,
  notebookNote,
  onOpenNotebooks,
  notebookButtonRef,
  isPrivate,
  onTogglePrivate,
}: {
  notebookName: string;
  notebookNote: string;
  onOpenNotebooks: () => void;
  notebookButtonRef?: Ref<HTMLButtonElement>;
  isPrivate: boolean;
  onTogglePrivate: () => void;
}) {
  return (
    <section aria-label="Notebook and privacy" className={`${CARD} flex flex-col gap-4 p-4`}>
      <div className="flex flex-col gap-1">
        <span id="notebook-label" className={SECTION_LABEL}>
          Notebook / Collection
        </span>
        <button
          ref={notebookButtonRef}
          type="button"
          aria-haspopup="dialog"
          aria-labelledby="notebook-label notebook-name"
          onClick={onOpenNotebooks}
          className="flex items-center justify-between gap-2 rounded-2xl bg-ch-container-low p-3 text-left text-ch-on-surface transition-colors hover:bg-ch-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold-soft text-brand-gold-text">
              <FolderOpenIcon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col">
              <span id="notebook-name" className="truncate text-[15px] font-semibold leading-5">
                {notebookName}
              </span>
              <span className="text-xs leading-4 text-ch-on-surface-variant">{notebookNote}</span>
            </span>
          </span>
          <ChevronDownIcon className="h-5 w-5 shrink-0 text-ch-on-surface-variant" aria-hidden />
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ch-container-high text-ch-on-surface-variant">
            <LockIcon className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col">
            <span
              id="private-label"
              className="text-[15px] font-semibold leading-5 text-ch-on-surface"
            >
              Keep Note Private
            </span>
            <span id="private-hint" className="text-xs leading-4 text-ch-on-surface-variant">
              {isPrivate ? "Only visible to you" : "You may share it once notes can be saved"}
            </span>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-labelledby="private-label"
          aria-describedby="private-hint"
          onClick={onTogglePrivate}
          className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2 ${isPrivate ? "bg-ch-primary" : "bg-ch-container-highest"}`}
        >
          <span
            className={`block h-6 w-6 rounded-full shadow-sm transition duration-200 ${isPrivate ? "translate-x-5 bg-ch-on-primary" : "translate-x-0 bg-ch-on-surface-variant"}`}
          />
        </button>
      </div>
    </section>
  );
}

const TOOL_BUTTON =
  "flex h-9 w-8 items-center justify-center rounded-full text-ch-on-surface transition-all hover:bg-ch-container min-[380px]:h-10 min-[380px]:w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95";

/** The sticky toolbar: four formatting buttons, voice dictation and Save Note. */
export function FormatToolbar({
  onFormat,
  dictating,
  onDictate,
  onSave,
}: {
  onFormat: (kind: FormatKind) => void;
  dictating: boolean;
  onDictate: () => void;
  onSave: () => void;
}) {
  // Keep focus (and the selection) in the note while a formatting button is pressed.
  const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();
  return (
    <div
      role="toolbar"
      aria-label="Note formatting"
      className="flex items-center justify-between rounded-full bg-ch-container-lowest/95 p-1 shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-0.5 min-[380px]:gap-1">
        <button
          type="button"
          aria-label="Bold text"
          onMouseDown={keepSelection}
          onClick={() => onFormat("bold")}
          className={TOOL_BUTTON}
        >
          <span className="text-sm font-bold">B</span>
        </button>
        <button
          type="button"
          aria-label="Italic text"
          onMouseDown={keepSelection}
          onClick={() => onFormat("italic")}
          className={TOOL_BUTTON}
        >
          <span className="font-display text-lg italic">I</span>
        </button>
        <button
          type="button"
          aria-label="Bullet list"
          onMouseDown={keepSelection}
          onClick={() => onFormat("bullet")}
          className={TOOL_BUTTON}
        >
          <ListBulletIcon className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Insert Scripture citation"
          onMouseDown={keepSelection}
          onClick={() => onFormat("quote")}
          className={TOOL_BUTTON}
        >
          <QuoteIcon className="h-5 w-5" />
        </button>
      </div>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          aria-label={dictating ? "Stop voice dictation" : "Voice dictation"}
          aria-pressed={dictating}
          onClick={onDictate}
          className={`flex items-center gap-1 rounded-full px-2.5 py-2 text-[13px] font-medium leading-[18px] transition-all min-[380px]:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary active:scale-95 ${dictating ? "bg-ch-error-container text-ch-error" : "bg-ch-container text-ch-primary"}`}
        >
          {dictating ? (
            <StopSquareIcon className="h-[18px] w-[18px] animate-pulse" aria-hidden />
          ) : (
            <MicIcon className="h-[18px] w-[18px]" aria-hidden />
          )}
          <span className="hidden sm:inline">{dictating ? "Stop" : "Dictate"}</span>
        </button>
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1 whitespace-nowrap rounded-full bg-ch-primary px-3 py-2 text-[13px] font-semibold min-[380px]:px-3.5 min-[380px]:text-[15px] leading-5 text-ch-on-primary shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary focus-visible:ring-offset-2 active:scale-95 min-[400px]:px-5"
        >
          <CheckIcon className="h-[18px] w-[18px]" aria-hidden />
          <span>Save Note</span>
        </button>
      </div>
    </div>
  );
}

/** A bottom sheet with one choice per row (spiritual posture, notebook). */
export function ChoiceSheet({
  open,
  onOpenChange,
  title,
  description,
  name,
  options,
  value,
  onChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  name: string;
  options: readonly { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      {...(returnFocusRef ? { returnFocusRef } : {})}
    >
      <fieldset className="divide-y divide-ch-container-high pb-2">
        <legend className="sr-only">{title}</legend>
        {options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-center justify-between py-3">
            <span className="text-sm font-semibold">{option.label}</span>
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="flex h-5 w-5 items-center justify-center rounded-full border border-ch-outline/50 text-transparent transition-colors peer-checked:border-ch-primary peer-checked:bg-ch-primary peer-checked:text-ch-on-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ch-primary peer-focus-visible:ring-offset-2"
            >
              <CheckIcon className="h-3 w-3" />
            </span>
          </label>
        ))}
      </fieldset>
    </SheetFrame>
  );
}
