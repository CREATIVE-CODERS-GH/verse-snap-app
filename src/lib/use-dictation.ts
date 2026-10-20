import { useCallback, useEffect, useRef, useState } from "react";

/** The slice of the Web Speech API this app uses (not in the standard DOM typings). */
interface RecognitionResultList {
  [index: number]: { [index: number]: { transcript: string } };
  length: number;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export type DictationState = "idle" | "listening" | "unsupported" | "error";

/** Voice input for a text field: one spoken phrase, delivered to `onText`. */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recognition = useRef<RecognitionLike | null>(null);
  const callback = useRef(onText);
  callback.current = onText;

  useEffect(() => () => recognition.current?.abort(), []);

  const toggle = useCallback(() => {
    if (state === "listening") {
      recognition.current?.stop();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setState("unsupported");
      return;
    }
    const instance = new Recognition();
    instance.lang = "en-US";
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) callback.current(transcript.replace(/[.?!]+$/, ""));
    };
    instance.onerror = () => setState("error");
    instance.onend = () => setState((current) => (current === "listening" ? "idle" : current));
    recognition.current = instance;
    try {
      instance.start();
      setState("listening");
    } catch {
      setState("error");
    }
  }, [state]);

  return { state, toggle, supported: recognitionConstructor() !== null };
}
