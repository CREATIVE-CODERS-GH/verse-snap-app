import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  CloseIcon,
  MicIcon,
  SearchIcon,
} from "@/components/stitch-icons";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

/*
 * First-run onboarding, shown by the Home route until it has been completed once: Welcome, then
 * the Speak a Verse, Search the Bible and Scan a Verse screens (Stitch onboarding set). Colours
 * come from the shared theme tokens, so it follows light and dark mode like the rest of the app.
 */

const STORAGE_KEY = "versesnap.onboarding.v1";
const STEPS = 4;

interface OnboardingProps {
  onComplete: () => void;
}

/**
 * Opening the app with `?onboarding` in the address shows onboarding again (it clears the saved
 * "completed" flag), so testers can replay it on any device without browser tools.
 */
export function resetOnboardingFromUrl(): void {
  if (typeof window === "undefined") return;
  if (!new URLSearchParams(window.location.search).has("onboarding")) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "complete";
  } catch {
    return false;
  }
}

function markComplete() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "complete");
  } catch {
    // The session can still continue when private storage is unavailable.
  }
}

/** One dot per screen; each one is a button so people can step back without a swipe. */
function Dots({
  step,
  onSelect,
  tone,
}: {
  step: number;
  onSelect: (step: number) => void;
  tone: "light" | "dark" | "onPrimary";
}) {
  return (
    <nav aria-label="Onboarding progress" className="flex items-center justify-center gap-1">
      {Array.from({ length: STEPS }, (_, index) => {
        const active = index === step;
        return (
          <button
            key={index}
            type="button"
            aria-label={`Go to screen ${index + 1} of ${STEPS}`}
            aria-current={active ? "step" : undefined}
            onClick={() => onSelect(index)}
            className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            <span
              className={cn(
                "block rounded-full transition-all duration-200",
                tone === "light"
                  ? cn("h-1.5 w-1.5", active ? "bg-white" : "bg-white/40")
                  : tone === "onPrimary"
                    ? cn(
                        "h-1.5",
                        active ? "w-5 bg-brand-on-primary" : "w-1.5 bg-brand-on-primary/40",
                      )
                    : active
                      ? "h-2 w-2 bg-brand-text"
                      : "h-1.5 w-1.5 bg-brand-border-strong",
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}

const PRIMARY_BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary py-3.5 text-center text-base font-medium text-brand-on-primary shadow-md transition-all hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas active:scale-[0.99]";

/** Example results shown on the Search screen (public-domain wording; nothing here is interactive). */
const SEARCH_EXAMPLES = [
  {
    reference: "John 14:27",
    text: "Peace I leave with you, my peace I give unto you…",
    stripe: "bg-brand-gold-text",
  },
  {
    reference: "Philippians 4:6–7",
    text: "Be careful for nothing; but in every thing by prayer…",
    stripe: "bg-brand-primary",
  },
  {
    reference: "Isaiah 26:3",
    text: "Thou wilt keep him in perfect peace…",
    stripe: "bg-brand-teal-text",
  },
];

/** Decorative sound bars beside the microphone; they pulse unless the person prefers less motion. */
function SoundBars({ heights }: { heights: string[] }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {heights.map((height, index) => (
        <span
          key={index}
          style={{ animationDelay: `${index * 0.15}s` }}
          className={cn(
            "w-1.5 animate-pulse rounded-full bg-brand-on-primary/80 motion-reduce:animate-none",
            height,
          )}
        />
      ))}
    </span>
  );
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const goTo = (next: number) => setStep(Math.max(0, Math.min(STEPS - 1, next)));

  const finish = () => {
    markComplete();
    onComplete();
  };

  // "Already have an account? Sign in" on the last screen ends onboarding and opens sign-in.
  const signIn = () => {
    markComplete();
    onComplete();
    void navigate({ to: "/auth" });
  };

  // Horizontal swipes move between screens; arrow keys do the same.
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goTo(step + (dx < 0 ? 1 : -1));
  };

  return (
    <main
      className="fixed inset-0 z-50 flex min-h-dvh select-none flex-col overflow-y-auto bg-brand-canvas font-stitch text-brand-text"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") goTo(step + 1);
        if (event.key === "ArrowLeft") goTo(step - 1);
      }}
      aria-roledescription="onboarding"
    >
      {step === 0 ? (
        /* ---------- 01 Welcome ---------- */
        <div className="flex min-h-dvh w-full flex-col">
          <section className="mx-auto flex w-full max-w-[30rem] flex-col items-center px-6 pt-[calc(3.5rem+env(safe-area-inset-top))] text-center">
            <BrandMark large className="mb-4 h-16 w-16 shadow-md" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mb-2 font-display text-[42px] font-medium leading-tight tracking-tight text-brand-text outline-none"
            >
              Verse Snap
            </h1>
            <p className="text-[15px] text-brand-text/90">Find your verse. Instantly.</p>
          </section>

          <section className="relative flex min-h-[26rem] w-full flex-1 flex-col justify-end">
            <div className="absolute inset-0 overflow-hidden">
              <img
                src="/stitch/onboarding-hero.jpg"
                alt="An open Bible on a lakeside rock at sunrise, with mountains in the distance"
                className="h-full w-full scale-105 object-cover object-[50%_75%]"
                draggable={false}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-brand-canvas via-brand-canvas/60 to-transparent" />
            </div>
            <div className="relative mx-auto flex w-full max-w-[30rem] flex-col items-center px-6 pb-[max(2.25rem,env(safe-area-inset-bottom))]">
              <p className="mb-4 text-center text-[15px] font-medium text-white drop-shadow-sm">
                Scripture is always within reach.
              </p>
              <div className="mb-5">
                <Dots step={step} onSelect={goTo} tone="light" />
              </div>
              <button
                type="button"
                onClick={() => goTo(1)}
                className="w-full rounded-full bg-white py-4 text-[17px] font-semibold text-[#1f2937] shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.99] active:bg-neutral-100"
              >
                Get Started
              </button>
            </div>
          </section>
        </div>
      ) : step === 1 ? (
        /* ---------- 02 Speak a Verse ---------- */
        <div className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-brand-primary text-brand-on-primary">
          <div
            className="pointer-events-none absolute -top-16 left-1/2 h-[340px] w-[340px] -translate-x-1/2 rounded-full bg-brand-on-primary/10 blur-3xl"
            aria-hidden
          />
          <div className="relative mx-auto flex w-full max-w-[30rem] flex-1 flex-col px-7 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={finish}
                className="rounded-full border border-brand-on-primary/30 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-on-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-on-primary"
              >
                Skip
              </button>
            </div>
            <div className="mt-3 flex flex-col items-center text-center">
              <BrandMark large className="h-14 w-14 rounded-2xl shadow-lg" />
              <p className="mt-2 text-base font-bold tracking-wide">Verse Snap</p>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-1 text-[13px] font-bold uppercase tracking-[0.28em] opacity-90 outline-none"
              >
                Speak a Verse
              </h1>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center py-6">
              <div className="flex w-full max-w-[340px] items-center justify-between" aria-hidden>
                <SoundBars heights={["h-2.5", "h-[18px]", "h-[26px]", "h-3.5"]} />
                <div className="flex h-[188px] w-[188px] items-center justify-center rounded-full border-2 border-brand-on-primary/50 bg-brand-on-primary/10 p-2.5 shadow-[0_0_50px_10px_rgba(255,255,255,0.12)]">
                  <div className="flex h-full w-full items-center justify-center rounded-full border border-brand-on-primary/30 bg-brand-on-primary/15">
                    <MicIcon className="h-14 w-14" />
                  </div>
                </div>
                <SoundBars heights={["h-3.5", "h-[26px]", "h-[18px]", "h-2.5"]} />
              </div>
              <div
                className="mt-6 flex items-center gap-2.5 rounded-full bg-brand-on-primary px-6 py-3 text-sm font-semibold text-brand-primary shadow-lg"
                aria-hidden
              >
                <span className="flex items-center gap-0.5">
                  <span className="h-3 w-1 rounded-full bg-brand-primary" />
                  <span className="h-4 w-1 rounded-full bg-brand-primary" />
                  <span className="h-2 w-1 rounded-full bg-brand-primary" />
                </span>
                Speak a verse…
              </div>
            </div>

            <footer>
              <div className="mb-5">
                <Dots step={step} onSelect={goTo} tone="onPrimary" />
              </div>
              <button
                type="button"
                onClick={() => goTo(2)}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-on-primary py-4 text-base font-semibold text-brand-primary shadow-xl transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-on-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary active:scale-[0.99]"
              >
                Continue
                <ArrowRightIcon className="h-4 w-4" aria-hidden />
              </button>
            </footer>
          </div>
        </div>
      ) : step === 2 ? (
        /* ---------- 03 Search the Bible ---------- */
        <div className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
          <section className="flex flex-col items-center text-center">
            <BrandMark large className="h-16 w-16 rounded-2xl shadow-md" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-4 text-[29px] font-extrabold leading-tight tracking-tight text-brand-text outline-none"
            >
              Search the Bible
            </h1>
            <p className="mt-2 max-w-[270px] text-sm leading-relaxed text-brand-text-muted">
              Find verses, topics and answers in seconds.
            </p>
          </section>

          <section className="mt-6 flex flex-1 flex-col gap-3" aria-label="Example search">
            <div
              className="flex items-center justify-between rounded-2xl border border-brand-border bg-brand-surface px-4 py-3.5 shadow-sm"
              aria-hidden
            >
              <span className="flex items-center gap-3">
                <SearchIcon className="h-5 w-5 text-brand-text-subtle" />
                <span className="text-[15px] font-medium text-brand-text">peace</span>
                <span className="h-4 w-0.5 animate-pulse rounded-full bg-brand-primary motion-reduce:animate-none" />
              </span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-border-strong text-brand-surface">
                <CloseIcon className="h-3 w-3" />
              </span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {SEARCH_EXAMPLES.map((example) => (
                <li
                  key={example.reference}
                  className="flex items-center justify-between rounded-2xl border border-brand-border bg-brand-surface p-4 shadow-sm"
                >
                  <span className="flex items-start gap-3.5 pr-2">
                    <span
                      className={cn("mt-0.5 h-9 w-1.5 shrink-0 rounded-full", example.stripe)}
                      aria-hidden
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-bold tracking-tight text-brand-text">
                        {example.reference}
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-[12.5px] text-brand-text-muted">
                        {example.text}
                      </span>
                    </span>
                  </span>
                  <ChevronRightIcon
                    className="h-4 w-4 shrink-0 text-brand-text-subtle"
                    aria-hidden
                  />
                </li>
              ))}
            </ul>
          </section>

          <footer className="pt-8">
            <div className="mb-5">
              <Dots step={step} onSelect={goTo} tone="dark" />
            </div>
            <button type="button" onClick={() => goTo(3)} className={PRIMARY_BUTTON}>
              Continue
              <ArrowRightIcon className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={finish}
              className="mt-3 w-full py-1 text-center text-xs font-medium text-brand-text-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
            >
              Skip for now
            </button>
          </footer>
        </div>
      ) : (
        /* ---------- 04 Scan a Verse ---------- */
        <div className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col">
          <header className="flex flex-col items-center px-6 pt-[calc(2rem+env(safe-area-inset-top))] text-center">
            <BrandMark large className="h-[68px] w-[68px] shadow-lg" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-5 text-2xl font-bold tracking-tight text-brand-text outline-none"
            >
              Scan a Verse
            </h1>
            <p className="mt-2 text-[14.5px] text-brand-text-muted">
              Take a photo and instantly get the verse.
            </p>
          </header>

          <div className="relative min-h-[16rem] flex-1 overflow-hidden">
            <img
              src="/stitch/onboarding-scan.jpg"
              alt="A phone held over an open Bible, scanning John 3:15"
              className="h-full w-full scale-[1.03] object-cover object-center"
              draggable={false}
            />
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-brand-canvas via-brand-canvas/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-brand-canvas via-brand-canvas/90 to-transparent" />
          </div>

          <footer className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-1">
            <div className="mb-5">
              <Dots step={step} onSelect={goTo} tone="dark" />
            </div>
            <button type="button" onClick={finish} className={PRIMARY_BUTTON}>
              Get Started
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </button>
            <p className="mt-3.5 text-center text-sm text-brand-text-muted">
              Already have an account?{" "}
              <button
                type="button"
                onClick={signIn}
                className="font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                Sign in
              </button>
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}
