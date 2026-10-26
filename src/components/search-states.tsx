import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  BookOpenIcon,
  DropletIcon,
  ExclamationIcon,
  HeartIcon,
  LightbulbIcon,
  MicIcon,
  SearchIcon,
  SearchOffIcon,
  SproutIcon,
  SunIcon,
  WifiIcon,
} from "@/components/stitch-icons";
import type { SearchSuggestion, SuggestionIcon } from "@/lib/bible/search-suggestions";

/*
 * Presentational pieces of the search screens, taken from the approved Stitch designs
 * (05 Search Results, 19 No Results, 15 Loading, 16 Network Error). They hold no search logic.
 */

export type MatchLevel = "high" | "good" | "related";

const BADGES: Record<MatchLevel, { label: string; className: string }> = {
  high: { label: "High match", className: "bg-vs-badge-high-bg text-vs-badge-high-text" },
  good: { label: "Good match", className: "bg-vs-badge-good-bg text-vs-badge-good-text" },
  related: { label: "Related", className: "bg-vs-badge-related-bg text-vs-badge-related-text" },
};

interface ResultRowContentProps {
  reference: string;
  translation: string;
  text: string;
  /** Other editions the same verse matched in (search groups one result per verse). */
  alsoIn?: readonly string[];
  /** Shown only when real match-level data exists; nothing in the app supplies it yet. */
  matchLevel?: MatchLevel;
}

export function ResultRowContent({
  reference,
  translation,
  text,
  alsoIn,
  matchLevel,
}: ResultRowContentProps) {
  const badge = matchLevel ? BADGES[matchLevel] : null;
  return (
    <>
      <span className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-[15px] font-bold tracking-tight text-vs-text">{reference}</span>
        <span className="text-[11px] font-medium text-vs-text-secondary">{translation}</span>
        {alsoIn && alsoIn.length > 0 ? (
          <span className="text-[11px] text-vs-text-secondary">· also {alsoIn.join(", ")}</span>
        ) : null}
      </span>
      <span className="mb-2 line-clamp-3 text-[13px] font-normal leading-relaxed text-vs-text-secondary">
        {text}
      </span>
      {badge ? (
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      ) : null}
    </>
  );
}

/** Centred message block: illustration, title, body and an optional action. */
export function StateMessage({
  illustration,
  title,
  titleClassName = "font-display text-xl font-bold tracking-tight text-vs-text",
  children,
  action,
}: {
  illustration: ReactNode;
  title: string;
  titleClassName?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col items-center px-2 text-center">
      {illustration}
      <h2 className={titleClassName}>{title}</h2>
      {children ? (
        <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-vs-text-secondary">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-6 flex w-full justify-center">{action}</div> : null}
    </div>
  );
}

/** Soft circle with a glow and two small badges, used for "no verses found" and "being prepared". */
export function IllustrationFrame({ icon }: { icon: ReactNode }) {
  return (
    <div className="relative mb-4 flex h-24 w-24 items-center justify-center" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-vs-primary/10 blur-xl" />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-vs-border/60 bg-vs-illus shadow-xs">
        <div className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-vs-primary text-vs-on-primary shadow-xs">
          <SproutIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </div>
        <div className="absolute -left-1 bottom-0 flex h-5 w-5 items-center justify-center rounded-full bg-vs-tan text-white shadow-xs">
          <SparklesMini />
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-vs-surface text-vs-primary shadow-xs">
          {icon}
        </div>
      </div>
    </div>
  );
}

function SparklesMini() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
    </svg>
  );
}

export const NoResultsIllustration = () => (
  <IllustrationFrame icon={<SearchOffIcon className="h-[26px] w-[26px]" />} />
);

export const PreparingIllustration = () => (
  <IllustrationFrame icon={<BookOpenIcon className="h-[26px] w-[26px]" strokeWidth={1.8} />} />
);

/** Stitch "15 — Loading State": spinner, title, subtitle. */
export function LoadingState() {
  return (
    <div
      className="flex flex-col items-center px-6 py-16 text-center"
      aria-busy="true"
      role="status"
    >
      <div className="relative mb-8 flex h-16 w-16 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 64 64" className="h-16 w-16 animate-spin text-vs-text" fill="none">
          <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="5" opacity="0.12" />
          <path
            d="M32 4a28 28 0 0128 28"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="mb-2 text-xl font-bold tracking-tight text-vs-text">Finding your verse…</p>
      <p className="text-sm font-normal text-vs-text-secondary">This won't take long.</p>
    </div>
  );
}

/** Stitch "16 — Network Error State" pattern: wifi icon with an alert badge. */
export function ErrorIllustration() {
  return (
    <div className="relative mb-6" aria-hidden>
      <WifiIcon className="h-16 w-16 text-vs-icon-muted" strokeWidth={1.8} />
      <div className="absolute -bottom-1 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-vs-bg bg-vs-error text-white shadow-sm">
        <ExclamationIcon className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

export const ERROR_TITLE_CLASS = "text-2xl font-bold tracking-tight text-vs-text";

export const PILL_PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-vs-primary px-6 text-sm font-semibold text-vs-on-primary shadow-sm transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95";
export const PILL_OUTLINE =
  "inline-flex h-12 w-full max-w-[260px] items-center justify-center rounded-full border border-vs-border-strong text-sm font-medium text-vs-text transition-all hover:bg-vs-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95";

export const NOT_FOUND_MESSAGE =
  "We couldn't find that Bible reference. Try speaking again or search for a different verse.";

/** Recovery actions for "Verse not found": reopen Say a Verse, or search by hand. */
export function NotFoundActions({ onRetry }: { onRetry?: (() => void) | undefined }) {
  return (
    <div className="flex w-full max-w-[260px] flex-col items-stretch gap-3">
      {onRetry ? (
        <button type="button" className={PILL_OUTLINE} onClick={onRetry}>
          Try again
        </button>
      ) : null}
      <Link to="/voice" className={`${PILL_PRIMARY} w-full`}>
        <MicIcon className="h-5 w-5" />
        Speak Again
      </Link>
      <Link to="/search" className={`${PILL_OUTLINE} gap-2`}>
        <SearchIcon className="h-5 w-5" />
        Search Manually
      </Link>
    </div>
  );
}

const SUGGESTION_ICONS: Record<SuggestionIcon, { icon: ReactNode; className: string }> = {
  droplet: { icon: <DropletIcon className="h-[15px] w-[15px]" />, className: "text-vs-primary" },
  sprout: { icon: <SproutIcon className="h-[15px] w-[15px]" />, className: "text-vs-tan" },
  heart: { icon: <HeartIcon className="h-[15px] w-[15px]" />, className: "text-brand-danger" },
  book: { icon: <BookOpenIcon className="h-[15px] w-[15px]" />, className: "text-vs-primary" },
  sun: { icon: <SunIcon className="h-[15px] w-[15px]" />, className: "text-brand-gold" },
};

/** "Try searching for:" card with tappable suggestion chips. */
export function SuggestionCard({
  suggestions,
  onPick,
}: {
  suggestions: readonly SearchSuggestion[];
  onPick: (suggestion: SearchSuggestion) => void;
}) {
  return (
    <section
      aria-label="Search suggestions"
      className="w-full rounded-2xl border border-vs-border/60 bg-vs-surface p-5 shadow-sm"
    >
      <div className="mb-3.5 flex items-center gap-2">
        <LightbulbIcon className="h-[18px] w-[18px] text-vs-primary" />
        <h3 className="text-sm font-semibold text-vs-text">Try searching for:</h3>
      </div>
      <ul className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const decoration = SUGGESTION_ICONS[suggestion.icon];
          return (
            <li key={suggestion.label}>
              <button
                type="button"
                onClick={() => onPick(suggestion)}
                className="inline-flex items-center gap-1.5 rounded-full border border-vs-border/70 bg-vs-bg px-3.5 py-2 text-xs font-medium text-vs-text transition-all hover:bg-vs-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                <span className={decoration.className} aria-hidden>
                  {decoration.icon}
                </span>
                <span>{suggestion.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Full-screen frame for the app-wide states below: centred on the canvas, on its own page. */
function FullScreenFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-canvas px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] font-stitch text-brand-text">
      <div className="w-full max-w-[30rem]">{children}</div>
    </main>
  );
}

/** Stitch "15 — Loading State" as a whole screen (page loading, slow first load). */
export function FullScreenLoading() {
  return (
    <FullScreenFrame>
      <LoadingState />
    </FullScreenFrame>
  );
}

/**
 * Stitch "16 — Network Error State" as a whole screen: wifi with an alert badge, "Connection
 * problem", and Try again. `offline` adjusts the message when the device itself has no connection.
 */
export function NetworkErrorScreen({
  onRetry,
  offline = false,
  secondary,
}: {
  onRetry: () => void;
  offline?: boolean;
  secondary?: ReactNode;
}) {
  return (
    <FullScreenFrame>
      <StateMessage
        illustration={<ErrorIllustration />}
        title="Connection problem"
        titleClassName={ERROR_TITLE_CLASS}
        action={
          <div className="flex w-full flex-col items-center gap-3">
            <button type="button" onClick={onRetry} className={PILL_OUTLINE}>
              Try again
            </button>
            {secondary}
          </div>
        }
      >
        {offline
          ? "You’re offline. Check your internet connection and try again. Chapters you’ve opened recently still work offline."
          : "We couldn’t reach the Bible service. Please check your internet connection and try again."}
      </StateMessage>
    </FullScreenFrame>
  );
}

/** True when an error looks like a lost connection rather than a bug. */
export function isConnectionError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!error || typeof error !== "object") return false;
  const { name, message, kind } = error as { name?: string; message?: string; kind?: string };
  if (kind === "network") return true;
  return (
    (name === "TypeError" && /fetch|network|load failed/i.test(message ?? "")) ||
    /Failed to fetch dynamically imported module|NetworkError|ERR_INTERNET/i.test(message ?? "")
  );
}
