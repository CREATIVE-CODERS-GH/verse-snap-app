import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { bibleService, type VerseRef } from "@/lib/bible/service";
import type { ParsedReference } from "@/lib/bible/parse-reference";
import { usePreferences } from "@/lib/preferences";

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
      { property: "og:description", content: "Speak a Bible reference and open the verse directly." },
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
  const { translation } = usePreferences();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const [state, setState] = useState<VoiceState>("idle");
  const [heard, setHeard] = useState("");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<VoiceOption[]>([]);

  const openReference = useCallback((reference: ParsedReference) => {
    setState("processing");
    if (reference.verse === undefined) {
      navigate({
        to: "/chapter/$translation/$book/$chapter",
        params: { translation, book: reference.bookId, chapter: String(reference.chapter) },
      });
      return;
    }
    const verseReference: VerseRef = {
      bookId: reference.bookId,
      bookName: reference.bookName,
      chapter: reference.chapter,
      verse: reference.verse,
    };
    navigate({
      to: "/verse/$translation/$book/$chapter/$verse",
      params: {
        translation,
        book: verseReference.bookId,
        chapter: String(verseReference.chapter),
        verse: String(verseReference.verse),
      },
    });
  }, [navigate, translation]);

  const stopRecognition = useCallback((abort = false) => {
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
    stopRecognition(true);
    setHeard("");
    setMessage("");
    setOptions([]);

    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setState("unsupported");
      setMessage("Voice search isn't available on this device.");
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
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
        setState("error");
        setMessage("Couldn't identify a Bible reference.");
        return;
      }
      if (valid.length === 1 && best.confidence >= 0.65) {
        openReference(best.reference);
        return;
      }
      setOptions(valid.slice(0, 3));
      setState("ambiguous");
    };

    recognition.onerror = (event) => {
      recognitionRef.current = null;
      if (!mountedRef.current) return;
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
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
    } catch {
      recognitionRef.current = null;
      setState("error");
      setMessage("Voice search couldn't start. Try again.");
    }
  }, [openReference, stopRecognition]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(startListening, 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      stopRecognition(true);
    };
  }, [startListening, stopRecognition]);

  const status = state === "idle"
    ? "Starting…"
    : state === "listening"
      ? "Listening…"
      : state === "processing"
        ? "Opening verse…"
        : state === "ambiguous"
          ? "Did you mean?"
          : message;

  return (
    <AppShell title="Say a Verse">
      <main className="flex min-h-[28rem] flex-col items-center pt-12 text-center">
        <h2 className="font-serif text-2xl font-semibold">What verse are you looking for?</h2>
        <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
          Say a reference such as “Hebrews chapter two verse five.”
        </p>

        <Button
          type="button"
          size="icon"
          variant={state === "listening" ? "default" : "outline"}
          className="mt-9 h-16 w-16 rounded-full"
          onClick={startListening}
          disabled={state === "processing"}
          aria-label={state === "listening" ? "Listening for a Bible reference" : "Start voice search"}
          aria-pressed={state === "listening"}
        >
          {state === "unsupported" || state === "error" ? (
            <MicOff className="h-6 w-6" aria-hidden />
          ) : (
            <Mic className="h-6 w-6" aria-hidden />
          )}
        </Button>

        <p className="mt-5 min-h-6 text-sm font-medium" role="status" aria-live="polite">
          {status}
        </p>
        {heard ? <p className="mt-3 max-w-sm font-serif text-xl leading-8">“{heard}”</p> : null}

        {state === "ambiguous" && options.length > 0 ? (
          <div className="mt-6 w-full border-t border-border pt-2">
            {options.map((option) => (
              <Button
                key={referenceLabel(option.reference)}
                type="button"
                variant="ghost"
                className="h-12 w-full justify-between border-b border-border px-1 text-[0.9375rem]"
                onClick={() => openReference(option.reference)}
              >
                <span>{referenceLabel(option.reference)}</span>
                <span className="text-xs text-muted-foreground">Open verse</span>
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-8 flex items-center gap-5">
          {(state === "error" || state === "ambiguous") ? (
            <Button type="button" variant="outline" onClick={startListening}>Try again</Button>
          ) : null}
          <Button asChild variant="link">
            <Link to={state === "unsupported" || state === "error" || state === "ambiguous" ? "/search" : "/"}>
              {state === "unsupported" || state === "error" || state === "ambiguous" ? "Search manually" : "Cancel"}
            </Link>
          </Button>
        </div>
      </main>
    </AppShell>
  );
}