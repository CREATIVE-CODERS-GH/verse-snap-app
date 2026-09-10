import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findReferences, type FoundReference } from "@/lib/bible/find-references";
import { parseReference } from "@/lib/bible/parse-reference";
import { captureFrame, prepareImageFile } from "@/lib/ocr/capture";
import { ocrService } from "@/lib/ocr/service";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";

type ScanState =
  | "starting"
  | "ready"
  | "reading"
  | "opening"
  | "confirm"
  | "edit"
  | "choose"
  | "denied"
  | "unsupported"
  | "error";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Snap a Verse — Verse Snap" },
      {
        name: "description",
        content: "Point your camera at a Bible reference and open the verse straight away.",
      },
      { property: "og:title", content: "Snap a Verse — Verse Snap" },
      {
        property: "og:description",
        content: "Point your camera at a Bible reference and open the verse straight away.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanPage,
});

function referenceLabel(reference: FoundReference): string {
  return `${reference.bookName} ${reference.chapter}${reference.verse === undefined ? "" : `:${reference.verse}`}`;
}

function ScanPage() {
  const navigate = useNavigate();
  const { translation } = usePreferences();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const readingRef = useRef(false);
  const [state, setState] = useState<ScanState>("starting");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<FoundReference[]>([]);
  const [detected, setDetected] = useState<FoundReference | null>(null);
  const [editedReference, setEditedReference] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openReference = useCallback(
    (reference: FoundReference) => {
      setState("opening");
      setMessage(referenceLabel(reference));
      stopCamera();
      if (reference.verse === undefined) {
        navigate({
          to: "/chapter/$translation/$book/$chapter",
          params: { translation, book: reference.bookId, chapter: String(reference.chapter) },
        });
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
    [navigate, stopCamera, translation],
  );

  const startCamera = useCallback(async () => {
    setMessage("");
    setOptions([]);
    setDetected(null);
    setEditedReference("");
    setState("starting");
    stopCamera();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      setMessage("Camera scanning works best on a mobile device.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState("ready");
      trackEvent("camera_opened");
    } catch (error) {
      if (!mountedRef.current) return;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setState("denied");
        setMessage("Camera access is needed to scan a Bible reference.");
        return;
      }
      setState("unsupported");
      setMessage("Camera scanning works best on a mobile device.");
    }
  }, [stopCamera]);

  const handleText = useCallback(
    (text: string, confidence: number) => {
      const references = findReferences(text, 5);
      trackEvent(references.length === 0 ? "camera_ocr_failed" : "camera_ocr_success", {
        matches: references.length,
      });
      if (references.length === 0) {
        setState("error");
        setMessage(
          confidence > 0 && confidence < 55
            ? "Couldn't read the reference clearly."
            : "No Bible reference found.",
        );
        return;
      }
      const only = references[0];
      if (references.length === 1 && only) {
        const isClear = confidence >= 72 && only.explicit;
        if (isClear) {
          openReference(only);
          return;
        }
        stopCamera();
        setDetected(only);
        setEditedReference(referenceLabel(only));
        setState("confirm");
        setMessage("Check the reference before opening it.");
        return;
      }
      setOptions(references);
      setState("choose");
      setMessage("Multiple verses found");
    },
    [openReference, stopCamera],
  );

  const submitEditedReference = useCallback(() => {
    const reference = parseReference(editedReference) ?? findReferences(editedReference, 1)[0];
    if (!reference) {
      setMessage("Enter a reference such as John 3:16.");
      return;
    }
    openReference({ ...reference, raw: editedReference, explicit: true });
  }, [editedReference, openReference]);

  const readImage = useCallback(
    async (image: Blob) => {
      // One read at a time; a second tap while reading is ignored.
      if (readingRef.current) return;
      readingRef.current = true;
      setState("reading");
      setMessage("Reading reference…");
      try {
        const result = await ocrService.recognize(image);
        if (!mountedRef.current) return;
        handleText(result.text, result.confidence);
      } catch {
        if (!mountedRef.current) return;
        trackEvent("camera_ocr_failed", { reason: "engine_error" });
        setState("error");
        setMessage("Couldn't read the reference clearly.");
      } finally {
        readingRef.current = false;
      }
    },
    [handleText],
  );

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const frame = await captureFrame(video);
    if (!frame) {
      setState("error");
      setMessage("Couldn't read the reference clearly.");
      return;
    }
    // Hold the captured frame on screen while it is read.
    video.pause();
    await readImage(frame);
  }, [readImage]);

  const handleUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const prepared = await prepareImageFile(file);
      await readImage(prepared);
    },
    [readImage],
  );

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const showCamera = state === "starting" || state === "ready" || state === "reading";

  return (
    <AppShell title="Snap a Verse">
      <main className="pb-6">
        <p className="text-[0.9375rem] text-muted-foreground">
          Point your camera at a Bible reference.
        </p>

        {showCamera ? (
          <div className="relative mt-5 aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="block h-full w-full object-cover"
              aria-label="Camera preview"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-sm border border-border/80"
            />
          </div>
        ) : null}

        <p className="mt-4 min-h-6 text-sm font-medium" role="status" aria-live="polite">
          {state === "starting"
            ? "Starting camera…"
            : state === "ready"
              ? "Line the reference up inside the frame."
              : message}
        </p>

        {state === "choose" && options.length > 0 ? (
          <div className="mt-2 border-t border-border">
            {options.map((option) => (
              <Button
                key={referenceLabel(option)}
                type="button"
                variant="ghost"
                className="h-12 w-full justify-between border-b border-border px-1 text-[0.9375rem]"
                onClick={() => openReference(option)}
              >
                <span>{referenceLabel(option)}</span>
                <span className="text-xs text-muted-foreground">Open verse</span>
              </Button>
            ))}
          </div>
        ) : null}

        {state === "confirm" && detected ? (
          <section className="mt-3 border-y border-border py-5 text-center" aria-labelledby="detected-reference">
            <p className="text-[0.9375rem] text-muted-foreground">We found something that looks like:</p>
            <h2 id="detected-reference" className="mt-2 font-serif text-2xl font-semibold">
              {referenceLabel(detected)}
            </h2>
            <p className="mt-2 text-[0.9375rem]">Is this correct?</p>
          </section>
        ) : null}

        {state === "edit" ? (
          <form
            className="mt-3 border-y border-border py-5"
            onSubmit={(event) => {
              event.preventDefault();
              submitEditedReference();
            }}
          >
            <label htmlFor="corrected-reference" className="text-sm font-medium">
              Edit Reference
            </label>
            <Input
              id="corrected-reference"
              value={editedReference}
              onChange={(event) => setEditedReference(event.target.value)}
              placeholder="John 3:16"
              autoComplete="off"
              autoFocus
              maxLength={80}
              className="mt-2 h-12 text-base"
            />
            <Button type="submit" className="mt-3 h-12 w-full">
              Open Verse
            </Button>
          </form>
        ) : null}

        <div className="mt-6 space-y-3">
          {state === "ready" ? (
            <Button type="button" className="h-14 w-full text-base" onClick={handleCapture}>
              Capture
            </Button>
          ) : null}


          {state === "confirm" && detected ? (
            <>
              <Button type="button" className="h-12 w-full" onClick={() => openReference(detected)}>
                Open Verse
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full bg-transparent"
                onClick={() => {
                  setState("edit");
                  setMessage("Correct the reference, then open it.");
                }}
              >
                Edit Reference
              </Button>
            </>
          ) : null}

          {state === "denied" || state === "error" || state === "choose" ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full bg-transparent"
              onClick={() => void startCamera()}
            >
              Try again
            </Button>
          ) : null}

          {state === "unsupported" || state === "denied" || state === "error" ? (
            <label className="flex h-12 w-full cursor-pointer items-center justify-center rounded-md border border-border text-[0.9375rem] focus-within:ring-2 focus-within:ring-ring">
              Upload a photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
            </label>
          ) : null}

          <div className="flex justify-center pt-1">
            <Button asChild variant="link">
              <Link
                to={
                  state === "ready" || state === "starting" || state === "confirm" ? "/" : "/search"
                }
              >
                {state === "ready" || state === "starting" || state === "confirm"
                  ? "Cancel"
                  : "Search manually"}
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
