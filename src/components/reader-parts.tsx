import type { ReactNode, Ref } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/stitch-icons";

/*
 * Presentational pieces of the single-verse reading screen (Stitch "06 — Scripture Reading").
 * No data fetching or app logic lives here.
 */

interface ReaderHeaderProps {
  title: string;
  translation: string;
  onBack: () => void;
  onOpenTranslations: () => void;
  /** Lets the translation sheet return focus here when it closes. */
  translationButtonRef?: Ref<HTMLButtonElement>;
}

export function ReaderHeader({
  title,
  translation,
  onBack,
  onOpenTranslations,
  translationButtonRef,
}: ReaderHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-[30rem] items-center justify-between px-5 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button
        type="button"
        aria-label="Go back"
        onClick={onBack}
        className="-ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-vs-text transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>
      <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-vs-text">
        {title}
      </h1>
      <button
        ref={translationButtonRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={`Bible translation: ${translation}. Change translation`}
        onClick={onOpenTranslations}
        className="relative flex items-center gap-1.5 rounded-full border border-vs-border-strong px-2.5 py-1 text-xs font-medium text-vs-text transition-colors after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] hover:bg-vs-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{translation}</span>
        <ChevronDownIcon className="h-3 w-3 text-vs-text-secondary" />
      </button>
    </header>
  );
}

/** The verse itself: Playfair, large, with a small non-selectable verse number. */
export function VerseFocus({ number, text }: { number: number; text: string }) {
  return (
    <p className="scripture-focus text-left text-vs-text selection:bg-vs-primary/15">
      <sup className="mr-1 select-none font-display text-[0.64em] font-normal text-brand-text-faint">
        {number}
      </sup>
      {text}
    </p>
  );
}

interface ReaderActionProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** For toggle buttons such as Save. */
  pressed?: boolean;
}

export function ReaderAction({ label, icon, onClick, disabled, pressed }: ReaderActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className={`group flex min-w-11 flex-col items-center disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pressed ? "text-vs-primary" : ""}`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center transition-colors group-hover:text-vs-primary ${pressed ? "text-vs-primary" : "text-vs-text"}`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="mt-1 text-[11px] font-normal text-vs-text-secondary">{label}</span>
    </button>
  );
}

const NAV_CARD =
  "flex items-center gap-1.5 rounded-xl border border-vs-border bg-vs-surface/80 px-3.5 py-2 shadow-sm";

/** Previous / Next verse card. `children` is the label block; wrap in a Link when it can be followed. */
export function VerseNavCardContent({
  direction,
  reference,
}: {
  direction: "previous" | "next";
  reference: string;
}) {
  const previous = direction === "previous";
  return (
    <>
      {previous ? <ChevronLeftIcon className="h-3.5 w-3.5 text-vs-text-secondary" /> : null}
      <span
        className={`flex flex-col leading-none ${previous ? "items-start text-left" : "items-end text-right"}`}
      >
        <span className="text-xs font-medium text-vs-text">{reference}</span>
        <span className="mt-0.5 text-[9px] uppercase tracking-wider text-vs-text-secondary">
          {previous ? "Previous" : "Next"}
        </span>
      </span>
      {previous ? null : <ChevronRightIcon className="h-3.5 w-3.5 text-vs-text-secondary" />}
    </>
  );
}

export const NAV_CARD_LINK = `${NAV_CARD} transition-colors active:bg-vs-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;
export const NAV_CARD_DISABLED = `${NAV_CARD} opacity-45`;
