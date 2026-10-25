import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "@tanstack/react-router";
import type { ReactNode, RefObject } from "react";
import { CheckIcon, CloseIcon } from "@/components/stitch-icons";
import { getLastRead } from "@/lib/last-read";
import type { TextSize } from "@/lib/preferences-storage";

/*
 * Bottom sheets and the menu used by the chapter reader (Stitch 22) and the Book & Chapter Index
 * (Stitch 21), in their cooler palette. They are small wrappers around the same Radix primitives the
 * translation sheet uses.
 */

export function SheetFrame({
  open,
  onOpenChange,
  title,
  description,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-brand-scrim data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef?.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-[32px] bg-ch-container-lowest px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 font-stitch text-ch-on-surface shadow-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ch-container-highest" aria-hidden />
          <header className="relative flex flex-col items-center justify-center border-b border-ch-container-high pb-4 pt-2">
            <Dialog.Title className="font-display text-xl font-medium">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-xs text-ch-on-surface-variant">
                {description}
              </Dialog.Description>
            ) : null}
            <Dialog.Close
              aria-label="Close"
              className="absolute right-0 top-1 flex h-8 w-8 items-center justify-center rounded-full text-ch-outline transition-colors hover:text-ch-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
            >
              <CloseIcon className="h-4 w-4" strokeWidth={2} />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const TEXT_SIZES: { value: TextSize; label: string; sample: string }[] = [
  { value: "small", label: "Small", sample: "text-[17px]" },
  { value: "medium", label: "Medium", sample: "text-[20px]" },
  { value: "large", label: "Large", sample: "text-[23px]" },
  { value: "xlarge", label: "Extra large", sample: "text-[26px]" },
];

interface TextSizeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TextSize;
  onChange: (value: TextSize) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Reading text size, saved through the same preference the Settings screen uses. */
export function TextSizeSheet({
  open,
  onOpenChange,
  value,
  onChange,
  returnFocusRef,
}: TextSizeSheetProps) {
  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Text size"
      description="Applies to scripture across the app"
      {...(returnFocusRef ? { returnFocusRef } : {})}
    >
      <fieldset className="divide-y divide-ch-container-high pb-2">
        <legend className="sr-only">Reading text size</legend>
        {TEXT_SIZES.map((size) => (
          <label
            key={size.value}
            className="group flex cursor-pointer items-center justify-between py-3"
          >
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{size.label}</span>
              <span
                className={`mt-0.5 font-display leading-snug text-ch-on-surface-variant ${size.sample}`}
              >
                Do not be conformed
              </span>
            </span>
            <input
              type="radio"
              name="reading_text_size"
              value={size.value}
              checked={value === size.value}
              onChange={() => onChange(size.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="flex h-5 w-5 items-center justify-center rounded-full border border-ch-outline/50 text-transparent transition-colors peer-checked:border-ch-primary peer-checked:bg-ch-primary peer-checked:text-ch-on-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ch-primary peer-focus-visible:ring-offset-2"
            >
              <CheckIcon className="h-3 w-3" />
            </span>
          </label>
        ))}
      </fieldset>
    </SheetFrame>
  );
}

const MENU_ITEM =
  "flex w-full cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-ch-container";

interface ReaderMenuProps {
  trigger: ReactNode;
  /** Which reading mode the current screen is. */
  active: "reader" | "index";
  /** Translation and book carried into the Book & Chapter Index link. */
  translation: string;
  bookId?: string;
}

/** The "Scripture Reader ▾" menu shared by the chapter reader and the Book & Chapter Index. */
export function ReaderMenu({ trigger, active, translation, bookId }: ReaderMenuProps) {
  const lastRead = getLastRead();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-[70] min-w-56 rounded-2xl border border-ch-container-high bg-ch-container-lowest p-1.5 font-stitch text-ch-on-surface shadow-xl"
        >
          <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ch-outline">
            Reading mode
          </DropdownMenu.Label>
          <DropdownMenu.Item asChild className={MENU_ITEM}>
            <Link
              to="/chapter/$translation/$book/$chapter"
              params={{
                translation,
                book: lastRead.bookId,
                chapter: String(lastRead.chapter),
              }}
              aria-current={active === "reader" ? "page" : undefined}
            >
              <span>Scripture Reader</span>
              {active === "reader" ? <CheckIcon className="h-4 w-4 text-ch-primary" /> : null}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={MENU_ITEM}>
            <Link
              to="/books"
              search={{ translation, ...(bookId ? { book: bookId } : {}) }}
              aria-current={active === "index" ? "page" : undefined}
            >
              <span>Book &amp; Chapter Index</span>
              {active === "index" ? <CheckIcon className="h-4 w-4 text-ch-primary" /> : null}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-ch-container-high" />
          <DropdownMenu.Item asChild className={MENU_ITEM}>
            <Link to="/settings">Reading settings</Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
