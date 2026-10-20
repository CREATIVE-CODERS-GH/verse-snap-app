import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type RefObject } from "react";
import { CheckIcon, CloseIcon } from "@/components/stitch-icons";

/**
 * Bible translation bottom sheet (Stitch "12 — Translation Selection"). It only lists the editions
 * it is given; the reader passes the app's translation catalogue, so nothing unsupported appears.
 */
export interface TranslationOption {
  code: string;
  name: string;
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
  return (
    <fieldset className="mt-2 divide-y divide-vs-border">
      <legend className="sr-only">Choose your preferred Bible translation</legend>
      {options.map((option) => (
        <label
          key={option.code}
          className="group flex cursor-pointer items-center justify-between py-3.5"
        >
          <span className="flex flex-col">
            <span className="text-base font-bold leading-tight text-vs-text">{option.code}</span>
            <span className="mt-0.5 text-xs text-vs-text-secondary">{option.name}</span>
          </span>
          <input
            type="radio"
            name="bible_translation"
            value={option.code}
            checked={value === option.code}
            onChange={() => onChange(option.code)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="flex h-5 w-5 items-center justify-center rounded-full border border-vs-border-strong text-transparent transition-colors group-hover:border-vs-icon-muted peer-checked:border-vs-primary peer-checked:bg-vs-primary peer-checked:text-vs-on-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
          >
            <CheckIcon className="h-3 w-3" />
          </span>
        </label>
      ))}
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
