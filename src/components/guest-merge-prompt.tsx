import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import {
  guestDevice,
  mergeableCounts,
  mergeableHighlights,
  mergeableHistory,
  runGuestMerge,
} from "@/lib/guest-merge";

/*
 * After sign-in, if this device holds Saved verses or History from before (as a guest), asks
 * whether to add them to the account. Nothing moves without the person's choice, because on a
 * shared device that guest data may belong to someone else.
 *
 * "Not now" leaves the items on this device (hidden while signed in, visible again after signing
 * out) and asks again next session. "Remove from this device" deletes them from the device only.
 */

const DISMISS_PREFIX = "versesnap.guest-merge.dismissed.";

function dismissed(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function dismiss(userId: string) {
  try {
    window.sessionStorage.setItem(DISMISS_PREFIX + userId, "1");
  } catch {
    /* storage unavailable: the prompt may show again */
  }
}

function describe(saved: number, history: number, chapters = 0, highlights = 0): string {
  const parts = [
    saved ? `${saved} saved verse${saved === 1 ? "" : "s"}` : "",
    history ? `${history} verse${history === 1 ? "" : "s"} from your history` : "",
    chapters ? `${chapters} chapter${chapters === 1 ? "" : "s"} you read` : "",
    highlights ? `${highlights} highlight${highlights === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length > 2
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts.join(" and ");
}

export function GuestMergePrompt() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({
    saved: 0,
    history: 0,
    chapters: 0,
    highlights: 0,
    total: 0,
  });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (loading || !user) {
      setOpen(false);
      return;
    }
    const next = mergeableCounts();
    setCounts(next);
    setConfirmRemove(false);
    setOpen(next.total > 0 && !dismissed(user.id));
  }, [user, loading]);

  if (!user) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["saved"] });
    void queryClient.invalidateQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["highlights"] });
  };

  const add = async () => {
    setBusy(true);
    const result = await runGuestMerge(user.id);
    setBusy(false);
    refresh();
    if (result.status === "done" || result.status === "nothing") {
      setOpen(false);
      const added =
        result.savedAdded + result.historyAdded + result.chaptersAdded + result.highlightsAdded;
      toast(added > 0 ? "Added to your account" : "Already in your account");
      return;
    }
    if (result.status === "partial") {
      const next = mergeableCounts();
      setCounts(next);
      toast("Some items couldn’t be added yet. They’re still on this device — try again.");
      return;
    }
    toast("Couldn’t confirm your account. Nothing was changed — please try again.");
  };

  const removeFromDevice = () => {
    // Removes only what this prompt offered (chapter visits and highlights once accounts hold them).
    guestDevice.removeSaved(guestDevice.saved().map((entry) => entry.id));
    guestDevice.removeHistory(mergeableHistory().map((entry) => entry.id));
    guestDevice.removeHighlights(mergeableHighlights().map((entry) => entry.id));
    setOpen(false);
    refresh();
    toast("Removed from this device");
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? setOpen(true) : null)}>
      <AlertDialogContent className="max-w-[22rem] rounded-2xl border-brand-border bg-brand-surface font-stitch text-brand-text">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="font-display text-lg">
            {confirmRemove ? "Remove from this device?" : "Add to your account?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-brand-text-muted">
            {confirmRemove
              ? `This deletes ${describe(counts.saved, counts.history, counts.chapters, counts.highlights)} kept on this device. Your account isn’t affected.`
              : `This device has ${describe(counts.saved, counts.history, counts.chapters, counts.highlights)} from before you signed in. Add them to your account so they’re available on all your devices?`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {confirmRemove ? (
            <>
              <button
                type="button"
                onClick={removeFromDevice}
                className="w-full rounded-full bg-brand-danger py-3 text-[15px] font-semibold text-brand-on-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                Remove from this device
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="w-full rounded-full border border-brand-border py-3 text-[15px] font-semibold text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                Go back
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void add()}
                disabled={busy}
                className="w-full rounded-full bg-brand-primary py-3 text-[15px] font-semibold text-brand-on-primary transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-60"
              >
                {busy ? "Adding…" : "Add to my account"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  dismiss(user.id);
                  setOpen(false);
                }}
                className="w-full rounded-full border border-brand-border py-3 text-[15px] font-semibold text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-60"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
                className="mx-auto mt-1 text-[13px] font-medium text-brand-text-muted hover:text-brand-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-60"
              >
                This isn’t mine — remove from this device
              </button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
