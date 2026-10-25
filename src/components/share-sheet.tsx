import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode, RefObject } from "react";
import { BrandMark } from "@/components/brand-mark";
import {
  CameraIcon,
  ChevronRightIcon,
  CopyDocIcon,
  GalleryIcon,
  MoreHorizIcon,
} from "@/components/stitch-icons";
import { trackEvent } from "@/lib/analytics";
import type { Verse } from "@/lib/bible/types";
import { translationName } from "@/lib/bible/translations";
import { copyText } from "@/lib/copy-text";
import { shareVerseCard, shareVerseText, verseShareText } from "@/lib/share-verse-card";

/*
 * Share Options — Stitch "13 Share Options": a bottom sheet with a preview of the verse card, quick
 * targets (Messages, WhatsApp, Instagram, More) and Copy text / Share as image / More options.
 * The coloured circles are the recognised colours of those apps (a functional exception to the
 * monochrome theme); everything else uses the shared tokens.
 */

interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verse: Verse;
  /** Shows short confirmations such as "Copied" (the page's toast). */
  notify: (message: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M12 3C6.48 3 2 6.94 2 11.8c0 2.7 1.4 5.1 3.6 6.7L5 22l4.1-2.1c.9.2 1.9.3 2.9.3 5.52 0 10-3.94 10-8.8S17.52 3 12 3z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M12 2.2a9.8 9.8 0 00-8.4 14.8L2.2 21.8l4.9-1.3A9.8 9.8 0 1012 2.2zm0 1.8a8 8 0 11-4.1 14.9l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0112 4zm-3.3 4.1c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4l-2-1c-.3-.1-.5-.1-.7.2l-.9 1.1c-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6z" />
    </svg>
  );
}

function Target({
  label,
  circle,
  icon,
  onClick,
}: {
  label: string;
  circle: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
    >
      <span
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-full shadow-sm transition-transform group-active:scale-95 ${circle}`}
      >
        {icon}
      </span>
      <span className="mt-1.5 text-center text-[11px] font-medium text-brand-text-muted">
        {label}
      </span>
    </button>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors active:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
    >
      <span className="flex items-center gap-3.5">
        <span className="text-brand-text-muted" aria-hidden>
          {icon}
        </span>
        <span className="text-[13.5px] font-medium text-brand-text">{label}</span>
      </span>
      <ChevronRightIcon
        className="h-4 w-4 text-brand-text-faint transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

export function ShareSheet({ open, onOpenChange, verse, notify, returnFocusRef }: ShareSheetProps) {
  const text = verseShareText(verse);
  const message = `${text}\n\nShared with Verse Snap`;
  const close = () => onOpenChange(false);

  const openLink = (url: string, target: string) => {
    trackEvent("verse_shared", { target });
    window.open(url, "_blank", "noopener,noreferrer");
    close();
  };

  const copy = async () => {
    try {
      await copyText(text);
      trackEvent("verse_copied");
      notify("Copied");
    } catch {
      notify("Could not copy this verse");
    }
    close();
  };

  const asImage = () => {
    close();
    void shareVerseCard(verse, notify);
  };

  const more = () => {
    close();
    void shareVerseText(verse, notify);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-brand-scrim data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef) return;
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-xl flex-col rounded-t-[32px] bg-brand-surface-muted px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3.5 font-stitch text-brand-text shadow-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-brand-border-strong" aria-hidden />

          <figure className="mb-4 rounded-2xl border border-brand-border bg-brand-canvas px-4 pb-3.5 pt-4 shadow-sm">
            <Dialog.Title className="mb-2 text-center text-[15px] font-bold text-brand-text">
              {verse.reference} ({verse.translation})
            </Dialog.Title>
            <blockquote className="mb-3.5 line-clamp-6 px-1 text-center font-display text-[13px] italic leading-[1.45] text-brand-text-muted">
              “{verse.text}”
            </blockquote>
            <figcaption className="flex items-center gap-2 border-t border-brand-border px-0.5 pt-2.5">
              <BrandMark className="h-7 w-7 rounded-lg" />
              <span className="flex flex-col text-left leading-tight">
                <span className="text-[11px] font-bold tracking-tight text-brand-text">
                  Verse Snap
                </span>
                <span className="text-[9.5px] text-brand-text-muted">
                  Find your verse. Instantly.
                </span>
              </span>
              <span className="sr-only">{translationName(verse.translation)}</span>
            </figcaption>
          </figure>

          <h3 className="mb-3 text-center text-[13px] font-semibold text-brand-text-muted">
            Share
          </h3>
          <div className="mb-4 grid grid-cols-4 gap-2 px-1">
            <Target
              label="Messages"
              circle="bg-[#34c759] text-white"
              icon={<ChatIcon />}
              onClick={() => openLink(`sms:?&body=${encodeURIComponent(message)}`, "messages")}
            />
            <Target
              label="WhatsApp"
              circle="bg-[#25d366] text-white"
              icon={<WhatsAppIcon />}
              onClick={() =>
                openLink(`https://wa.me/?text=${encodeURIComponent(message)}`, "whatsapp")
              }
            />
            <Target
              label="Instagram"
              circle="bg-gradient-to-tr from-[#ffdc80] via-[#fd1d1d] to-[#833ab4] text-white"
              icon={<CameraIcon className="h-6 w-6" />}
              onClick={() => {
                // Instagram has no web link for sharing text, so share the verse card image.
                notify("Choose Instagram, or post the saved image from your gallery");
                asImage();
              }}
            />
            <Target
              label="More"
              circle="bg-brand-surface-strong text-brand-text"
              icon={<MoreHorizIcon className="h-6 w-6" />}
              onClick={more}
            />
          </div>

          <div className="divide-y divide-brand-border overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-sm">
            <ActionRow
              icon={<CopyDocIcon className="h-5 w-5" />}
              label="Copy text"
              onClick={() => void copy()}
            />
            <ActionRow
              icon={<GalleryIcon className="h-5 w-5" />}
              label="Share as image"
              onClick={asImage}
            />
            <ActionRow
              icon={<MoreHorizIcon className="h-5 w-5" />}
              label="More options..."
              onClick={more}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
