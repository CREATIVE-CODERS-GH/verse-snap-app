import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, MicIcon, SearchIcon } from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import { referenceExists } from "@/lib/bible/reference-exists";
import { classifyQuery } from "@/lib/bible/classify-query";
import { routeQuery } from "@/lib/bible/search-router";
import type { ParsedReference } from "@/lib/bible/parse-reference";
import { usePreferences } from "@/lib/preferences";
import { micProfile } from "@/lib/preferences-storage";
import { trackEvent } from "@/lib/analytics";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { cn } from "@/lib/utils";

interface SpeechAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}

interface SpeechResultListLike {
  readonly length: number;
  [index: number]: SpeechResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type VoiceState = "idle" | "listening" | "processing" | "error" | "ambiguous" | "unsupported";

interface VoiceOption {
  transcript: string;
  confidence: number;
  reference: ParsedReference;
}

export const Route = createFileRoute("/voice")({
  head: () => ({
    meta: [
      { title: "Say a Bible Verse — Verse Snap" },
      { name: "description", content: "Speak a Bible reference and open the verse directly." },
      { property: "og:title", content: "Say a Bible Verse — Verse Snap" },
      {
        property: "og:description",
        content: "Speak a Bible reference and open the verse directly.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoicePage,
});

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const voiceWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
}

function referenceLabel(reference: ParsedReference): string {
  return `${reference.bookName} ${reference.chapter}${reference.verse === undefined ? "" : `:${reference.verse}`}`;
}

function VoicePage() {
  const navigate = useNavigate();
  const { translation, speechLanguage, micSensitivity, autoListen, ready } = usePreferences();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startingRef = useRef(false);
  const startTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<VoiceState>("idle");
  const [heard, setHeard] = useState("");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<VoiceOption[]>([]);

  const openReference = useCallback(
    async (reference: ParsedReference) => {
      setState("processing");
      if (reference.verse === undefined) {
        navigate({
          to: "/chapter/$translation/$book/$chapter",
          params: { translation, book: reference.bookId, chapter: String(reference.chapter) },
        });
        return;
      }
      // A verse number past the end of the chapter (Hebrews 5:25) stays here, so every
      // unrecognised reference ends on this one recovery screen.
      if (!(await referenceExists(reference, translation, bibleService.getVerse))) {
        if (!mountedRef.current) return;
        trackEvent("voice_search_failed", { reason: "verse_missing" });
        setOptions([]);
        setState("error");
        setMessage(`${referenceLabel(reference)} doesn't exist in this translation.`);
        return;
      }
      navigate({
        to: "/verse/$translation/$book/$chapter/$verse",
        params: {
          translation,
          book: reference.bookId,
          chapter: String(reference.chapter),
          verse: String(reference.verse),
        },
      });
    },
    [navigate, translation],
  );

  const stopRecognition = useCallback((abort = false) => {
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    if (abort) recognition.abort();
    else recognition.stop();
    recognitionRef.current = null;
  }, []);

  const startListening = useCallback(() => {
    // Guards against a second microphone session being opened by a fast
    // double tap while one is still starting up.
    if (startingRef.current) return;
    startingRef.current = true;
    stopRecognition(true);
    setHeard("");
    setMessage("");
    setOptions([]);

    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      startingRef.current = false;
      setState("unsupported");
      setMessage("Voice search isn't available on this device.");
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = speechLanguage;
    recognition.maxAlternatives = micProfile(micSensitivity).maxAlternatives;

    recognition.onstart = () => {
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
      startingRef.current = false;
      trackEvent("voice_search_started");
      if (mountedRef.current) setState("listening");
    };

    recognition.onresult = (event) => {
      const latest = event.results[event.resultIndex];
      if (!latest) return;
      const first = latest[0];
      if (first && mountedRef.current) setHeard(first.transcript.trim());
      if (!latest.isFinal) return;

      setState("processing");
      const distinct = new Map<string, VoiceOption>();
      for (let index = 0; index < Math.min(latest.length, 3); index += 1) {
        const alternative = latest[index];
        if (!alternative) continue;
        const reference = bibleService.parseReference(alternative.transcript);
        if (!reference) continue;
        const key = `${reference.bookId}-${reference.chapter}-${reference.verse ?? "chapter"}`;
        if (!distinct.has(key)) {
          distinct.set(key, {
            transcript: alternative.transcript.trim(),
            confidence: alternative.confidence,
            reference,
          });
        }
      }

      const valid = [...distinct.values()];
      stopRecognition();
      if (!mountedRef.current) return;
      const best = valid[0];
      if (!best) {
        // Not a reference — use the first meaningful speech alternative as a description.
        for (let index = 0; index < Math.min(latest.length, 3); index += 1) {
          const spoken = latest[index]?.transcript ?? "";
          const decision = spoken ? routeQuery(spoken) : null;
          if (decision?.canTryAi) {
            trackEvent("voice_search_success", { kind: "description" });
            // Free search handles it; AI starts only from the explicit "Try Smart Search" button.
            navigate({ to: "/search", search: { q: decision.query } });
            return;
          }
        }
        trackEvent("voice_search_failed", { reason: "no_reference" });
        setState("error");
        setMessage("Couldn't identify a Bible reference.");
        return;
      }
      if (valid.length === 1 && best.confidence >= 0.65) {
        trackEvent("voice_search_success", { kind: "reference" });
        void openReference(best.reference);
        return;
      }
      setOptions(valid.slice(0, 3));
      setState("ambiguous");
    };

    recognition.onerror = (event) => {
      recognitionRef.current = null;
      startingRef.current = false;
      if (!mountedRef.current) return;
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      trackEvent("voice_search_failed", { reason: denied ? "permission" : event.error });
      setMessage(
        denied
          ? "Microphone access is needed for voice search."
          : event.error === "no-speech"
            ? "No speech was detected. Try again."
            : "Voice search couldn't start. Try again.",
      );
      setState("error");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      startingRef.current = false;
      if (mountedRef.current) {
        setState((current) => {
          if (current !== "listening") return current;
          setMessage("No speech was detected. Try again.");
          return "error";
        });
      }
    };

    try {
      setState("idle");
      recognition.start();
      // Some browsers advertise speech recognition but never start a session;
      // don't leave the person watching "Starting…" forever.
      startTimerRef.current = window.setTimeout(() => {
        startTimerRef.current = null;
        if (!mountedRef.current) return;
        setState((current) => {
          if (current !== "idle") return current;
          stopRecognition(true);
          trackEvent("voice_search_failed", { reason: "no_start" });
          setMessage("Voice search isn't available on this device.");
          return "unsupported";
        });
      }, 7000);
    } catch {
      recognitionRef.current = null;
      startingRef.current = false;
      setState("error");
      setMessage("Voice search couldn't start. Try again.");
    }
  }, [navigate, openReference, stopRecognition, speechLanguage, micSensitivity]);

  // Starts listening on open unless "Auto-listen on launch" is turned off in Voice & Audio.
  const autoStarted = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    let timer = 0;
    if (ready && autoListen && !autoStarted.current) {
      autoStarted.current = true;
      timer = window.setTimeout(startListening, 0);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, autoListen, startListening]);
  useEffect(
    () => () => {
      mountedRef.current = false;
      stopRecognition(true);
    },
    [stopRecognition],
  );

  const goBack = useBackOrHome();
  // With auto-listen off, the page waits for a tap instead of starting by itself.
  const waitingForTap = state === "idle" && !autoStarted.current && !autoListen;
  const idleText = waitingForTap ? "Tap the microphone to start." : "Starting the microphone…";
  const failed = state === "error" || state === "unsupported";
  const showExamples = !heard && (state === "idle" || state === "listening");
  const heading =
    state === "processing"
      ? "Finding verse…"
      : state === "ambiguous"
        ? "Did you mean?"
        : failed
          ? message
          : "Speak a Bible reference";
  const status =
    state === "idle"
      ? idleText
      : state === "listening"
        ? "Listening…"
        : state === "processing"
          ? "Finding verse…"
          : state === "ambiguous"
            ? "Choose the reference you said."
            : message;

  return (
    <div className="flex min-h-dvh flex-col bg-brand-canvas font-stitch text-brand-text">
      <nav className="relative flex shrink-0 items-center px-6 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => {
            stopRecognition(true);
            goBack();
          }}
          className="relative z-10 -ml-1 flex h-10 w-10 items-center justify-center rounded-full text-brand-text transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          <ChevronLeftIcon className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-[17px] font-semibold tracking-tight">
          Say a Verse
        </h1>
      </nav>

      <main className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col items-center justify-center px-8">
        <div className="relative mb-8 flex h-72 w-72 items-center justify-center">
          <span
            aria-hidden
            className={cn(
              "absolute h-64 w-64 rounded-full bg-brand-primary-soft/60",
              state === "listening" && "animate-voice-ripple",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "absolute h-48 w-48 rounded-full bg-brand-primary-soft",
              state === "listening" && "animate-voice-ripple [animation-delay:0.3s]",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "absolute h-36 w-36 rounded-full bg-brand-primary/15",
              state === "listening" && "animate-voice-ripple [animation-delay:0.6s]",
            )}
          />
          <button
            type="button"
            onClick={startListening}
            disabled={state === "processing"}
            aria-label={
              state === "listening" ? "Listening for a Bible reference" : "Start voice search"
            }
            aria-pressed={state === "listening"}
            className={cn(
              "relative z-10 flex h-24 w-24 items-center justify-center rounded-full shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-focus/40 active:scale-95 disabled:opacity-70",
              failed
                ? "bg-brand-surface-strong text-brand-text-muted"
                : "bg-brand-primary text-brand-on-primary",
            )}
          >
            <MicIcon className="h-10 w-10" />
          </button>
        </div>

        <div className="w-full max-w-xs space-y-3 text-center">
          <h2 className="text-[19px] font-bold tracking-tight text-brand-text">{heading}</h2>
          <p className="sr-only" role="status" aria-live="polite">
            {status}
          </p>
          {heard ? (
            <p className="font-display text-xl italic leading-8 text-brand-text">“{heard}”</p>
          ) : null}
          {showExamples ? (
            <div className="flex flex-col items-center space-y-1 text-[13px] leading-relaxed">
              <span className="text-brand-text-faint">For example:</span>
              <span className="italic text-brand-text-muted">“John 3:16”</span>
              <span className="italic text-brand-text-muted">“Hebrews chapter two verse five”</span>
              <span className="italic text-brand-text-muted">
                “the verse about renewing your mind”
              </span>
            </div>
          ) : null}
          {state === "idle" ? (
            <p className="text-[13px] text-brand-text-muted">{idleText}</p>
          ) : null}
        </div>

        {state === "ambiguous" && options.length > 0 ? (
          <ul className="mt-6 w-full divide-y divide-brand-border overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
            {options.map((option) => (
              <li key={referenceLabel(option.reference)}>
                <button
                  type="button"
                  onClick={() => void openReference(option.reference)}
                  className="flex min-h-12 w-full items-center justify-between px-4 text-left text-[15px] font-medium transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
                >
                  <span>{referenceLabel(option.reference)}</span>
                  <span className="text-xs text-brand-text-muted">Open verse</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </main>

      <footer className="mx-auto flex w-full max-w-[30rem] shrink-0 flex-col items-center gap-3 px-6 pb-[max(2.25rem,env(safe-area-inset-bottom))] pt-2">
        {failed || state === "ambiguous" ? (
          <>
            <button
              type="button"
              onClick={startListening}
              className="w-full rounded-full bg-brand-primary py-3.5 text-[15px] font-semibold text-brand-on-primary transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas"
            >
              Try again
            </button>
            <Link
              to="/search"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
            >
              <SearchIcon className="h-4 w-4" />
              Search manually
            </Link>
          </>
        ) : null}
        {failed || state === "ambiguous" ? null : (
          <button
            type="button"
            onClick={() => {
              stopRecognition(true);
              goBack();
            }}
            className="w-full rounded-full bg-brand-surface-sunken py-3.5 text-[15px] font-semibold text-brand-text transition-colors hover:bg-brand-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            Cancel
          </button>
        )}
      </footer>
    </div>
  );
}
