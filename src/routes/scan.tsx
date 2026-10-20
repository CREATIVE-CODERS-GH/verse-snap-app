import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpenIcon,
  CloseIcon,
  EditNoteIcon,
  ExclamationIcon,
  FlashIcon,
  FlashOffIcon,
  FlipCameraIcon,
  GalleryIcon,
  RefreshIcon,
  SearchIcon,
} from "@/components/stitch-icons";
import { findReferences, type FoundReference } from "@/lib/bible/find-references";
import { parseReference } from "@/lib/bible/parse-reference";
import { captureFrame, prepareImageFile } from "@/lib/ocr/capture";
import { ocrService } from "@/lib/ocr/service";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { cn } from "@/lib/utils";

/*
 * Snap a Verse — Stitch "08 Camera Scanning" (live viewfinder, detected-reference card, shutter)
 * and "20 Camera Unrecognized" (paused frame and the bottom sheet for every problem state).
 * The camera screen is dark in both themes, like a native camera; the sheet follows the theme.
 */

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

type Facing = "environment" | "user";

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

const GLASS_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95 disabled:opacity-40";
const SHEET_PRIMARY =
  "flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-4 py-3.5 text-[15px] font-medium text-brand-on-primary shadow-lg transition-all hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-surface active:scale-[0.99]";
const SHEET_SECONDARY =
  "flex w-full items-center justify-center gap-2 rounded-full border border-brand-border bg-brand-surface px-4 py-3.5 text-[15px] font-medium text-brand-text transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus active:scale-[0.99]";

function ScanPage() {
  const navigate = useNavigate();
  const goBack = useBackOrHome();
  const { translation } = usePreferences();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const readingRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<FoundReference[]>([]);
  const [detected, setDetected] = useState<FoundReference | null>(null);
  const [editedReference, setEditedReference] = useState("");
  const [facing, setFacing] = useState<Facing>("environment");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hasLiveVideo, setHasLiveVideo] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasLiveVideo(false);
    setTorchOn(false);
  }, []);

  const openReference = useCallback(
    (reference: FoundReference) => {
      setState("opening");
      setDetected(reference);
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

  const startCamera = useCallback(
    async (mode: Facing = "environment") => {
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
          video: { facingMode: { ideal: mode } },
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
        // The flash (torch) only exists on some rear cameras.
        const track = stream.getVideoTracks()[0];
        const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvailable(Boolean(capabilities.torch));
        setHasLiveVideo(true);
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
    },
    [stopCamera],
  );

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchAvailable) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  const flipCamera = () => {
    const next: Facing = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void startCamera(next);
  };

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
    if (!video || state !== "ready") return;
    const frame = await captureFrame(video);
    if (!frame) {
      setState("error");
      setMessage("Couldn't read the reference clearly.");
      return;
    }
    // Hold the captured frame on screen while it is read.
    video.pause();
    await readImage(frame);
  }, [readImage, state]);

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

  const close = () => {
    stopCamera();
    goBack();
  };
  const retry = () => void startCamera(facing);
  const typeManually = () => {
    stopCamera();
    setState("edit");
    setMessage("");
  };

  const sheetOpen =
    state === "error" ||
    state === "denied" ||
    state === "unsupported" ||
    state === "confirm" ||
    state === "choose" ||
    state === "edit";
  const paused = state === "error" || state === "denied" || state === "unsupported";
  const status =
    state === "starting"
      ? "Starting camera…"
      : state === "ready"
        ? "Line the reference up inside the frame."
        : message;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-black font-stitch text-white">
      {/* Camera feed, or a still photo when no camera is available */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
          className={cn("h-full w-full object-cover", !hasLiveVideo && "hidden")}
        />
        {!hasLiveVideo ? (
          <img
            src="/stitch/scan-fallback.jpg"
            alt=""
            aria-hidden
            className="h-full w-full scale-[1.03] object-cover brightness-[0.7] contrast-[1.05]"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/10 to-black/80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.55)_100%)]" />
      </div>

      {/* Top controls */}
      <header className="relative z-30 flex items-center justify-between px-5 pb-3 pt-[calc(1rem+env(safe-area-inset-top))]">
        <button type="button" aria-label="Close camera" onClick={close} className={GLASS_BUTTON}>
          <CloseIcon className="h-[22px] w-[22px]" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-brand-gold/40 bg-black/55 px-3.5 py-1.5 shadow-lg backdrop-blur-md">
          <BookOpenIcon className="h-[18px] w-[18px] text-brand-gold-bright" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-gold-bright/90">
            Scripture Lens
          </span>
        </div>
        <button
          type="button"
          aria-label={
            torchAvailable ? (torchOn ? "Turn flash off" : "Turn flash on") : "Flash unavailable"
          }
          aria-pressed={torchOn}
          disabled={!torchAvailable}
          onClick={() => void toggleTorch()}
          className={GLASS_BUTTON}
        >
          {torchOn ? (
            <FlashIcon className="h-5 w-5" strokeWidth={2} />
          ) : (
            <FlashOffIcon className="h-5 w-5" strokeWidth={2} />
          )}
        </button>
      </header>

      {/* Viewfinder */}
      <div className="pointer-events-none relative z-20 -mt-3 flex flex-1 select-none flex-col items-center justify-center px-6">
        <div className="relative flex aspect-[4/3] w-full max-w-[290px] flex-col">
          <span className="absolute -left-1 -top-1 h-8 w-8 rounded-tl-xl border-l-[3.5px] border-t-[3.5px] border-white drop-shadow-md" />
          <span className="absolute -right-1 -top-1 h-8 w-8 rounded-tr-xl border-r-[3.5px] border-t-[3.5px] border-white drop-shadow-md" />
          <span className="absolute -bottom-1 -left-1 h-8 w-8 rounded-bl-xl border-b-[3.5px] border-l-[3.5px] border-white drop-shadow-md" />
          <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-br-xl border-b-[3.5px] border-r-[3.5px] border-white drop-shadow-md" />
          {paused ? (
            <>
              <span className="absolute inset-2.5 rounded-xl border border-dashed border-brand-gold/50 bg-brand-gold/[0.05]" />
              <span className="m-auto flex flex-col items-center gap-2">
                <span className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full border border-brand-gold/40 bg-brand-gold/20 shadow-lg backdrop-blur-md">
                  <ExclamationIcon className="h-7 w-7 text-brand-gold-bright" />
                </span>
                <span className="rounded-full border border-brand-gold/20 bg-black/50 px-3 py-1 text-[12px] font-medium tracking-wide text-brand-gold-bright/90 shadow backdrop-blur-md">
                  Scanning paused
                </span>
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Status card and camera controls */}
      {!sheetOpen ? (
        <footer className="relative z-30 flex w-full flex-col items-center pb-[max(2rem,env(safe-area-inset-bottom))]">
          <section aria-live="polite" role="status" className="mb-8 w-[270px] max-w-[85vw]">
            {state === "reading" || state === "opening" ? (
              <div className="rounded-2xl border border-white/10 bg-[#18191b]/95 px-5 py-3 text-center shadow-2xl backdrop-blur-md">
                <p className="mb-0.5 text-[12px] text-stone-300">
                  {state === "opening" ? "Reference detected" : "Reading the page…"}
                </p>
                <h2 className="text-xl font-bold tracking-tight text-white">
                  {state === "opening" && detected ? referenceLabel(detected) : "One moment"}
                </h2>
              </div>
            ) : (
              <p className="mx-auto w-fit rounded-full bg-black/50 px-3.5 py-1.5 text-center text-[13px] text-white/90 backdrop-blur-md">
                {status}
              </p>
            )}
          </section>
          <div className="flex w-full max-w-[30rem] items-center justify-between px-10">
            <button
              type="button"
              aria-label="Choose a photo from your gallery"
              onClick={() => uploadRef.current?.click()}
              className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:opacity-70"
            >
              <GalleryIcon className="h-7 w-7" />
            </button>
            <button
              type="button"
              aria-label="Take photo"
              onClick={() => void handleCapture()}
              disabled={state !== "ready"}
              className="group flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-black disabled:opacity-60"
            >
              <span className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-[3.5px] border-white transition-transform duration-100 group-active:scale-95">
                <span className="h-[60px] w-[60px] rounded-full bg-white group-active:bg-stone-200" />
              </span>
            </button>
            <button
              type="button"
              aria-label="Switch camera"
              onClick={flipCamera}
              disabled={!hasLiveVideo}
              className="flex h-12 w-12 items-center justify-center rounded-full transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:opacity-70 disabled:opacity-40"
            >
              <FlipCameraIcon className="h-7 w-7" />
            </button>
          </div>
        </footer>
      ) : (
        <ScanSheet>
          {paused ? (
            <>
              <SheetHeading
                title={
                  state === "denied"
                    ? "Camera Access Needed"
                    : state === "unsupported"
                      ? "Camera Unavailable"
                      : "No Reference Detected"
                }
                subtitle={state === "error" ? "Text couldn't be parsed" : message}
              />
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-brand-text-muted">
                {state === "error"
                  ? "Ensure the Bible book name, chapter, and verse numerals are clearly visible, in good lighting, and within the scanning frame."
                  : state === "denied"
                    ? "Allow camera access for Verse Snap in your browser settings, or choose a photo of the page instead."
                    : "You can still choose a photo of the page, or type the reference yourself."}
              </p>
              <div className="mt-4 flex w-full flex-col gap-2.5">
                {state === "unsupported" ? (
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className={SHEET_PRIMARY}
                  >
                    <GalleryIcon className="h-5 w-5" /> Choose a Photo
                  </button>
                ) : (
                  <button type="button" onClick={retry} className={SHEET_PRIMARY}>
                    <RefreshIcon className="h-5 w-5" /> Try Again
                  </button>
                )}
                <button type="button" onClick={typeManually} className={SHEET_SECONDARY}>
                  <EditNoteIcon className="h-5 w-5" /> Type Reference Manually
                </button>
                {state !== "unsupported" ? (
                  <button
                    type="button"
                    onClick={() => uploadRef.current?.click()}
                    className="mx-auto mt-1 text-[13px] font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
                  >
                    Choose a photo instead
                  </button>
                ) : null}
              </div>
            </>
          ) : state === "confirm" && detected ? (
            <>
              <SheetHeading
                title="Is this correct?"
                subtitle="Check the reference before opening it."
              />
              <p className="mt-4 text-center font-display text-[28px] font-semibold text-brand-text">
                {referenceLabel(detected)}
              </p>
              <div className="mt-4 flex w-full flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => openReference(detected)}
                  className={SHEET_PRIMARY}
                >
                  Open Verse
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setState("edit");
                    setMessage("");
                  }}
                  className={SHEET_SECONDARY}
                >
                  <EditNoteIcon className="h-5 w-5" /> Edit Reference
                </button>
                <button
                  type="button"
                  onClick={retry}
                  className="mx-auto mt-1 text-[13px] font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
                >
                  Scan again
                </button>
              </div>
            </>
          ) : state === "choose" ? (
            <>
              <SheetHeading title="Multiple Verses Found" subtitle="Choose the one you meant." />
              <ul className="mt-3 divide-y divide-brand-border overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
                {options.map((option) => (
                  <li key={referenceLabel(option)}>
                    <button
                      type="button"
                      onClick={() => openReference(option)}
                      className="flex min-h-12 w-full items-center justify-between px-4 text-left text-[15px] font-medium text-brand-text transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
                    >
                      <span>{referenceLabel(option)}</span>
                      <span className="text-xs text-brand-text-muted">Open verse</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <button type="button" onClick={retry} className={SHEET_SECONDARY}>
                  <RefreshIcon className="h-5 w-5" /> Scan Again
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitEditedReference();
              }}
            >
              <SheetHeading
                title="Type a Reference"
                subtitle="For example, John 3:16 or Romans 12"
              />
              <label htmlFor="corrected-reference" className="sr-only">
                Bible reference
              </label>
              <input
                id="corrected-reference"
                value={editedReference}
                onChange={(event) => setEditedReference(event.target.value)}
                placeholder="John 3:16"
                autoComplete="off"
                autoFocus
                maxLength={80}
                className="mt-4 h-12 w-full rounded-full border border-brand-border bg-brand-surface px-5 text-base text-brand-text placeholder:text-brand-text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              />
              {message ? (
                <p className="mt-2 text-[13px] text-brand-danger" role="alert">
                  {message}
                </p>
              ) : null}
              <div className="mt-4 flex w-full flex-col gap-2.5">
                <button type="submit" className={SHEET_PRIMARY}>
                  Open Verse
                </button>
                <button type="button" onClick={retry} className={SHEET_SECONDARY}>
                  <RefreshIcon className="h-5 w-5" /> Back to Camera
                </button>
                <Link
                  to="/search"
                  className="mx-auto mt-1 flex items-center gap-1.5 text-[13px] font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
                >
                  <SearchIcon className="h-4 w-4" /> Search the Bible instead
                </Link>
              </div>
            </form>
          )}
        </ScanSheet>
      )}

      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void handleUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/** The light bottom sheet from Stitch 20, used for every state that needs a decision. */
function ScanSheet({ children }: { children: ReactNode }) {
  return (
    <section
      aria-live="polite"
      className="relative z-30 mx-auto w-full max-w-xl rounded-t-[28px] border-t border-white/60 bg-brand-canvas/95 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 text-brand-text shadow-2xl backdrop-blur-2xl dark:border-white/10"
    >
      <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-brand-border-strong" aria-hidden />
      {children}
    </section>
  );
}

function SheetHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-gold/40 bg-brand-gold-soft text-brand-gold-text shadow-sm"
        aria-hidden
      >
        <ExclamationIcon className="h-[22px] w-[22px]" />
      </span>
      <div className="flex flex-col">
        <h2 className="text-[18px] font-bold leading-tight tracking-tight text-brand-text">
          {title}
        </h2>
        <span className="text-[12px] font-medium text-brand-gold-text">{subtitle}</span>
      </div>
    </div>
  );
}
