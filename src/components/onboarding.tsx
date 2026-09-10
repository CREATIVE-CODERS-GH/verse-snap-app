import { Camera, ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { Button } from "./ui/button";

const STORAGE_KEY = "versesnap.onboarding.v1";

interface OnboardingProps {
  onComplete: () => void;
}

export function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "complete";
  } catch {
    return false;
  }
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const complete = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "complete");
    } catch {
      // The session can still continue when private storage is unavailable.
    }
    onComplete();
  };

  return (
    <main className="fixed inset-0 z-50 flex min-h-dvh flex-col bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-foreground">
      <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col">
        <div className="flex min-h-11 items-center justify-between">
          {step > 0 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setStep((current) => current - 1)}
              aria-label="Previous onboarding screen"
            >
              <ChevronLeft aria-hidden />
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button type="button" variant="ghost" className="min-h-11 px-3" onClick={complete}>
              Skip
            </Button>
          ) : null}
        </div>

        <section className="flex flex-1 flex-col justify-center pb-10" aria-live="polite">
          {step === 0 ? (
            <div>
              <BrandMark className="h-12 w-12" />
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-7 font-serif text-3xl font-semibold outline-none"
              >
                Verse Snap
              </h1>
              <p className="mt-2 text-lg text-muted-foreground">Find your verse. Instantly.</p>
              <p className="mt-10 max-w-sm font-serif text-xl leading-9">
                See a Bible reference? Snap it.
                <br />
                Hear a Bible reference? Say it.
              </p>
            </div>
          ) : step === 1 ? (
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="font-serif text-3xl font-semibold outline-none"
              >
                Find Scripture quickly
              </h1>
              <div className="mt-9 border-y border-border">
                <div className="flex min-h-16 items-center gap-4 border-b border-border">
                  <Mic className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
                  <span className="font-medium">Say a Verse</span>
                </div>
                <div className="flex min-h-16 items-center gap-4">
                  <Camera className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
                  <span className="font-medium">Snap a Verse</span>
                </div>
              </div>
              <p className="mt-7 max-w-sm text-base leading-7 text-muted-foreground">
                Find Scripture without typing through books and chapters.
              </p>
            </div>
          ) : (
            <div>
              <BrandMark className="h-12 w-12" />
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="mt-7 font-serif text-3xl font-semibold outline-none"
              >
                You’re ready.
              </h1>
              <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground">
                Find a verse by saying it, snapping it, or searching for what you remember.
              </p>
            </div>
          )}
        </section>

        <div>
          <div className="mb-5 flex justify-center gap-2" aria-label={`Step ${step + 1} of 3`}>
            {[0, 1, 2].map((item) => (
              <span
                key={item}
                className={cn("h-1.5 w-6 rounded-full", item === step ? "bg-primary" : "bg-muted")}
                aria-hidden
              />
            ))}
          </div>
          <Button
            type="button"
            className="h-12 w-full text-base"
            onClick={() => (step === 2 ? complete() : setStep((current) => current + 1))}
          >
            {step === 2 ? "Get Started" : "Next"}
            {step < 2 ? <ChevronRight aria-hidden /> : null}
          </Button>
        </div>
      </div>
    </main>
  );
}
