import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { PILL_OUTLINE, PILL_PRIMARY } from "@/components/search-states";
import { EditNoteIcon } from "@/components/stitch-icons";
import { HighlightPicker, type Tone } from "@/components/verse-annotation-parts";
import type { Reflection } from "@/lib/journal";
import { plainNote } from "@/lib/reflection-format";
import { selectionLabel } from "@/lib/verse-selection";

/**
 * The compact bar shown while several verses are chosen: how many, the highlight colours (the
 * same picker as the single-verse sheet) with Clear, and Done.
 */
export function MultiSelectBar({
  count,
  active,
  onPick,
  onDone,
}: {
  count: number;
  /** The colour every chosen verse already has, or null when they differ. */
  active: Tone | null;
  onPick: (tone: Tone) => void;
  onDone: () => void;
}) {
  return (
    <section
      aria-label="Selected verses"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md px-3"
    >
      <div className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-ch-container-high bg-ch-container-lowest p-2 shadow-lg">
        <div className="flex items-center justify-between gap-2 px-2 pt-1">
          <p role="status" aria-live="polite" className="text-sm font-semibold text-ch-on-surface">
            {selectionLabel(count)}
          </p>
          <button
            type="button"
            onClick={onDone}
            className="flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-ch-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
          >
            Done
          </button>
        </div>
        <HighlightPicker active={active} onChange={onPick} />
      </div>
    </section>
  );
}

/** The small note icon after a verse number. Its tap area is 44px without taking any room. */
export function NoteIconButton({ verse, onOpen }: { verse: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-note-icon={verse}
      aria-label={`Reflection on verse ${verse}`}
      aria-haspopup="dialog"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="relative ml-1.5 inline-flex h-4 w-4 items-center justify-center align-[-0.2em] rounded-full text-ch-secondary after:absolute after:-inset-3.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
    >
      <EditNoteIcon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** A saved reflection shown over the Reader, without leaving it. */
export function ReflectionNoteDialog({
  open,
  onOpenChange,
  reference,
  reflection,
  notebookName,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: string;
  reflection: Reflection | null;
  notebookName?: string | undefined;
  onEdit: () => void;
}) {
  const body = reflection ? plainNote(reflection.body).trim() : "";
  // The reflection is gone by the time the dialog finishes closing; remember which icon opened it.
  const lastVerse = useRef<number | null>(null);
  if (reflection) lastVerse.current = reflection.verse;
  return (
    <Dialog.Root open={open && reflection !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-brand-scrim data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // Back to the icon that opened it, without moving the page.
            const icon = document.querySelector<HTMLElement>(
              `[data-note-icon="${lastVerse.current}"]`,
            );
            if (!icon) return;
            event.preventDefault();
            icon.focus({ preventScroll: true });
          }}
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-xl flex-col rounded-t-[32px] bg-ch-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3.5 font-stitch text-ch-on-surface shadow-2xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ch-container-high" aria-hidden />
          <Dialog.Title className="text-base font-bold">{reference}</Dialog.Title>
          {reflection ? (
            <div className="mt-3 flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
              {reflection.title.trim() ? (
                <h3 className="text-[15px] font-semibold">{reflection.title.trim()}</h3>
              ) : null}
              {body ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ch-on-surface">
                  {body}
                </p>
              ) : null}
              {notebookName ? (
                <p className="text-xs text-ch-on-surface-variant">Notebook: {notebookName}</p>
              ) : null}
              {reflection.tags.length > 0 ? (
                <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
                  {reflection.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-ch-container-high px-2.5 py-1 text-xs text-ch-on-surface"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="mt-5 flex gap-3">
            <Dialog.Close className={`${PILL_OUTLINE} flex-1`}>Close</Dialog.Close>
            <button type="button" onClick={onEdit} className={`${PILL_PRIMARY} flex-1`}>
              Edit Reflection
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
