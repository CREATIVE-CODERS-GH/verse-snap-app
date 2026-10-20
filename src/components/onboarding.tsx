import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowRightIcon, CameraIcon, MicIcon, SearchIcon } from "@/components/stitch-icons";
import { BrandMark } from "@/components/brand-mark";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * First-run onboarding (Stitch 01 Welcome, 02 How It Works, 03 Get Started), shown by the Home
 * route until it has been completed once. Colours come from the shared theme tokens, so it follows
 * light and dark mode like the rest of the app.
 */

const STORAGE_KEY = "versesnap.onboarding.v1";
const STEPS = 3;

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

/** Three dots; each one is a button so people can step back without a swipe. */
function Dots({
  step,
  onSelect,
  tone,
}: {
  step: number;
  onSelect: (step: number) => void;
  tone: "light" | "dark";
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
  "w-full rounded-full bg-brand-primary py-3.5 text-center text-base font-medium text-brand-on-primary shadow-md transition-all hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas active:scale-[0.99]";

function Feature({
  icon,
  circle,
  title,
  text,
}: {
  icon: ReactNode;
  circle: string;
  title: string;
  text: string;
}) {
  return (
    <li className="flex items-center gap-4">
      <span
        className={cn(
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-sm",
          circle,
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="mb-0.5 text-[17px] font-semibold leading-tight text-brand-text">
          {title}
        </span>
        <span className="text-[13px] leading-normal text-brand-text-muted">{text}</span>
      </span>
    </li>
  );
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const { translation } = usePreferences();

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const goTo = (next: number) => setStep(Math.max(0, Math.min(STEPS - 1, next)));

  const finish = () => {
    markComplete();
    onComplete();
  };

  // "John 3:16" on the last screen opens that verse straight away.
  const openFirstVerse = () => {
    markComplete();
    onComplete();
    void navigate({
      to: "/verse/$translation/$book/$chapter/$verse",
      params: { translation, book: "john", chapter: "3", verse: "16" },
    });
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
                alt="A person sitting on a rocky mountain ledge, looking out over a valley at sunset"
                className="h-full w-full scale-105 object-cover object-bottom"
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
        /* ---------- 02 How It Works ---------- */
        <div className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-between">
          <div>
            <section className="px-8 pb-6 pt-[calc(3.5rem+env(safe-area-inset-top))]">
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-[32px] font-bold leading-[1.2] tracking-tight text-brand-text outline-none"
              >
                Three simple ways
                <br />
                to find Scripture.
              </h1>
            </section>
            <ul className="flex flex-col gap-6 px-8 pt-3">
              <Feature
                icon={<MicIcon className="h-6 w-6" />}
                circle="bg-brand-gold-soft text-brand-gold-text"
                title="Say a Verse"
                text="Speak a Bible reference."
              />
              <Feature
                icon={<CameraIcon className="h-6 w-6" />}
                circle="bg-brand-primary-soft text-brand-primary"
                title="Snap a Verse"
                text="Point your camera at a Bible reference."
              />
              <Feature
                icon={<SearchIcon className="h-6 w-6" />}
                circle="bg-brand-teal-soft text-brand-teal-text"
                title="Search the Bible"
                text="Enter a reference or describe a verse."
              />
            </ul>
          </div>
          <footer className="px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-10">
            <div className="mb-6">
              <Dots step={step} onSelect={goTo} tone="dark" />
            </div>
            <button type="button" onClick={() => goTo(2)} className={PRIMARY_BUTTON}>
              Next
            </button>
          </footer>
        </div>
      ) : (
        /* ---------- 03 Get Started ---------- */
        <div className="relative flex min-h-dvh w-full flex-col overflow-hidden">
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            fill="none"
            preserveAspectRatio="none"
            viewBox="0 0 390 844"
            aria-hidden
          >
            <path
              d="M-60 490C30 460 120 540 230 495C330 455 370 510 440 480V844H-60V490Z"
              className="fill-brand-primary-soft"
              opacity="0.7"
            />
            <path
              d="M-40 560C50 540 140 600 250 565C340 535 390 580 440 560V844H-40V560Z"
              className="fill-brand-primary-soft"
            />
          </svg>
          <div className="relative mx-auto flex w-full max-w-[30rem] flex-1 flex-col items-center justify-between px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top))] text-center">
            <div className="flex max-w-[300px] flex-col items-center">
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-[32px] font-bold leading-[1.2] tracking-tight text-brand-text outline-none"
              >
                Let’s find
                <br />
                your first verse.
              </h1>
              <p className="mt-3 max-w-[270px] text-[14.5px] leading-relaxed text-brand-text-muted">
                Try saying, snapping or searching for a Bible reference.
              </p>
            </div>

            <div className="my-auto flex w-full items-center justify-center py-6">
              <div className="relative -rotate-[7deg]">
                <div className="flex h-[175px] w-[280px] items-center justify-center rounded-[24px] border border-brand-border bg-brand-surface-muted/90 p-5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={openFirstVerse}
                    aria-label="Open John 3:16"
                    className="flex h-[52px] w-[220px] items-center justify-between rounded-full border border-brand-border bg-brand-surface px-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus active:scale-[0.98]"
                  >
                    <span className="text-base font-semibold tracking-tight text-brand-text">
                      John 3:16
                    </span>
                    <ArrowRightIcon className="h-4 w-4 text-brand-text-muted" aria-hidden />
                  </button>
                </div>
              </div>
            </div>

            <footer className="w-full">
              <div className="mb-6">
                <Dots step={step} onSelect={goTo} tone="dark" />
              </div>
              <button type="button" onClick={finish} className={PRIMARY_BUTTON}>
                Start Exploring
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
