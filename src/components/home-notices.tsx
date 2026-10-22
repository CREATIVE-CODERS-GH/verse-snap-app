import { useEffect, useState } from "react";
import { CloseIcon, ShareIosIcon, WifiOffIcon } from "@/components/stitch-icons";
import { useOfflineDownloads } from "@/lib/bible/use-offline-downloads";
import {
  readDismissed,
  readInstallEnvironment,
  shouldShowIosGuide,
  writeDismissed,
} from "@/lib/install-guide";
import { useOnlineStatus } from "@/lib/use-online-status";

const NOTICE =
  "flex items-start gap-3 rounded-2xl border border-vs-border bg-vs-surface px-4 py-3 text-left";

/**
 * Quiet notes between the Home heading and its cards: the iPhone install guide (once, dismissible) and, while there is
 * no connection, what still works. Neither is a popup, and neither takes space when not needed.
 */
export function HomeNotices() {
  return (
    <div className="flex flex-col gap-3 empty:hidden [&:not(:empty)]:mt-4">
      <OfflineNote />
      <IosInstallGuide />
    </div>
  );
}

function OfflineNote() {
  const online = useOnlineStatus();
  const { downloaded } = useOfflineDownloads();
  if (online) return null;
  return (
    <div className={NOTICE} role="status">
      <WifiOffIcon className="mt-0.5 h-5 w-5 shrink-0 text-vs-icon-muted" />
      <p className="text-[13px] leading-relaxed text-vs-text-secondary">
        <span className="font-semibold text-vs-text">You’re offline.</span>{" "}
        {downloaded.length > 0
          ? `${downloaded.join(" and ")} ${downloaded.length === 1 ? "is" : "are"} downloaded and can be read without a connection. `
          : "Download a translation in Settings to read without a connection. "}
        Search, cross-references and account saving need a connection.
      </p>
    </div>
  );
}

function IosInstallGuide() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(
      shouldShowIosGuide(readInstallEnvironment(), {
        dismissed: readDismissed(),
      }),
    );
  }, []);

  if (!show) return null;
  return (
    <section className={NOTICE} aria-label="Install Verse Snap on your iPhone">
      <ShareIosIcon className="mt-0.5 h-5 w-5 shrink-0 text-vs-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-vs-text">Add Verse Snap to your Home Screen</p>
        <p className="mt-1 text-[13px] leading-relaxed text-vs-text-secondary">
          Tap <span className="font-semibold text-vs-text">Share</span> in Safari, then{" "}
          <span className="font-semibold text-vs-text">Add to Home Screen</span>. Verse Snap then
          opens like an app, straight from your Home Screen.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          writeDismissed();
          setShow(false);
        }}
        aria-label="Dismiss install tip"
        className="-mr-2 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-vs-icon-muted transition-colors hover:text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-primary"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
