import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type RefObject } from "react";
import {
  CheckCircleIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  TrashIcon,
} from "@/components/stitch-icons";
import { canDownloadOffline } from "@/lib/bible/offline-download";
import type { OfflineEntry } from "@/lib/bible/offline-manager";
import { useOfflineDownloads } from "@/lib/bible/use-offline-downloads";

/**
 * Bible translation bottom sheet (Stitch "12 — Translation Selection"). It only lists the editions
 * it is given; the reader passes the app's translation catalogue, so nothing unsupported appears.
 */
export interface TranslationOption {
  code: string;
  name: string;
}

const OFFLINE_BUTTON =
  "-my-2.5 flex h-10 w-8 shrink-0 items-center justify-center rounded-full text-vs-icon-muted transition-colors hover:text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-primary";

/**
 * The offline controls, shown right after the abbreviation: a small download icon, then the percent
 * while it downloads (tap to cancel), then a check with a small bin to remove it. They are buttons
 * of their own, so tapping them never selects the translation or closes the sheet.
 */
function OfflineControls({
  option,
  entry,
  onStart,
  onCancel,
  onRemove,
}: {
  option: TranslationOption;
  entry: OfflineEntry;
  onStart: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  if (entry.status === "downloaded") {
    return (
      <span className="ml-1 flex items-center" onClick={stop}>
        <span
          role="img"
          aria-label={`${option.name} is downloaded for offline reading`}
          className="flex h-10 w-7 shrink-0 items-center justify-center text-vs-primary -my-2.5"
        >
          <CheckCircleIcon className="h-4 w-4" />
        </span>
        {confirming ? (
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
            aria-label={`Confirm removing the download of ${option.name}`}
            className="ml-0.5 rounded-full border border-vs-border-strong px-2 py-0.5 text-[11px] font-semibold text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-primary"
          >
            Remove?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Remove the download of ${option.name}`}
            className={OFFLINE_BUTTON}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </span>
    );
  }
  if (entry.status === "downloading") {
    return (
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          onCancel();
        }}
        aria-label={`Cancel the download of ${option.name}`}
        className={`${OFFLINE_BUTTON} ml-1 w-auto px-2 text-[11px] font-semibold tabular-nums text-vs-primary`}
      >
        {Math.floor(entry.fraction * 100)}%
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        stop(event);
        onStart();
      }}
      aria-label={
        entry.status === "failed"
          ? `Try downloading ${option.name} again`
          : `Download ${option.name} for offline reading`
      }
      className={`${OFFLINE_BUTTON} ml-1`}
    >
      <DownloadIcon className="h-4 w-4" />
    </button>
  );
}

/** The line under a row while downloading or after a failure. A downloaded row has no extra line. */
function OfflineCaption({ option, entry }: { option: TranslationOption; entry: OfflineEntry }) {
  if (entry.status === "downloading") {
    const percent = Math.floor(entry.fraction * 100);
    return (
      <div className="pb-3" role="status" aria-live="polite">
        <div
          role="progressbar"
          aria-label={`Downloading ${option.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 w-full overflow-hidden rounded-full bg-vs-border"
        >
          <div
            className="h-full rounded-full bg-vs-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-vs-text-secondary">
          {entry.phase === "saving"
            ? "Saving to this device…"
            : entry.phase === "verifying"
              ? "Checking…"
              : "Downloading…"}{" "}
          {percent}%
        </p>
      </div>
    );
  }
  if (entry.status === "failed") {
    return (
      <p className="pb-3 text-xs text-vs-text-secondary" role="status">
        {entry.error ?? "Download failed. Try again."}
      </p>
    );
  }
  return null;
}

export function TranslationOptions({
  options,
  value,
  onChange,
}: {
  options: readonly TranslationOption[];
  value: string;
  onChange: (code: string) => void;
}) {
  const offline = useOfflineDownloads();
  return (
    <fieldset className="mt-2 divide-y divide-vs-border">
      <legend className="sr-only">Choose your preferred Bible translation</legend>
      {options.map((option) => {
        const downloadable = offline.supported && canDownloadOffline(option.code);
        const entry = offline.entry(option.code);
        return (
          <div key={option.code} data-translation-row={option.code}>
            <div
              className="group flex cursor-pointer items-center justify-between py-3.5"
              onClick={() => onChange(option.code)}
            >
              <input
                type="radio"
                name="bible_translation"
                value={option.code}
                aria-label={`${option.code}, ${option.name}`}
                checked={value === option.code}
                onChange={() => onChange(option.code)}
                className="peer sr-only"
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center">
                  <span className="text-base font-bold leading-tight text-vs-text">
                    {option.code}
                  </span>
                  {downloadable ? (
                    <OfflineControls
                      option={option}
                      entry={entry}
                      onStart={() => offline.start(option.code)}
                      onCancel={() => offline.cancel(option.code)}
                      onRemove={() => offline.remove(option.code)}
                    />
                  ) : null}
                </span>
                <span className="mt-0.5 text-xs text-vs-text-secondary">{option.name}</span>
              </span>
              <span
                aria-hidden
                className="flex h-5 w-5 items-center justify-center rounded-full border border-vs-border-strong text-transparent transition-colors group-hover:border-vs-icon-muted peer-checked:border-vs-primary peer-checked:bg-vs-primary peer-checked:text-vs-on-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
              >
                <CheckIcon className="h-3 w-3" />
              </span>
            </div>
            {downloadable ? <OfflineCaption option={option} entry={entry} /> : null}
          </div>
        );
      })}
    </fieldset>
  );
}

interface TranslationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The translation currently shown (kept in the URL). */
  current: string;
  options: readonly TranslationOption[];
  /** Called with the chosen code when Done is pressed. Closing otherwise changes nothing. */
  onConfirm: (code: string) => void;
  /** The control that opened the sheet; focus goes back to it on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function TranslationSheet({
  open,
  onOpenChange,
  current,
  options,
  onConfirm,
  returnFocusRef,
}: TranslationSheetProps) {
  const [selected, setSelected] = useState(current);
  useEffect(() => {
    if (open) setSelected(current);
  }, [open, current]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-brand-scrim data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // The sheet has no Dialog.Trigger, so hand focus back to the opening control ourselves.
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[30rem] flex-col rounded-t-[32px] bg-vs-surface px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 font-stitch text-vs-text shadow-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-vs-border-strong" aria-hidden />
          <header className="relative flex items-center justify-center border-b border-vs-border pb-5 pt-2">
            <Dialog.Title className="text-base font-semibold tracking-tight">
              Bible translation
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="absolute right-0 top-1 flex h-8 w-8 items-center justify-center rounded-full text-vs-icon-muted transition-colors hover:text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CloseIcon className="h-4 w-4" strokeWidth={2} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TranslationOptions options={options} value={selected} onChange={setSelected} />
          </div>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            className="mt-6 w-full rounded-full bg-vs-primary py-3.5 text-center text-sm font-medium text-vs-on-primary shadow-sm transition-all duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99]"
          >
            Done
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
