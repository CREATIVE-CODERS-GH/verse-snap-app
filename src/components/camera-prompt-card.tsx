import { Link } from "@tanstack/react-router";
import { CameraIcon, ChevronRightIcon } from "@/components/stitch-icons";

/** "Have a physical Bible?" card from Stitch "19 — Search No Results"; opens the camera scanner. */
export function CameraPromptCard() {
  return (
    <Link
      to="/scan"
      className="mb-2 mt-6 flex w-full items-center justify-between rounded-2xl border border-vs-border/70 bg-vs-surface p-4 shadow-xs transition-colors hover:bg-vs-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-3.5 pr-2">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-vs-cam-border bg-vs-cam-bg text-vs-cam-text"
          aria-hidden
        >
          <CameraIcon className="h-[21px] w-[21px]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-tight text-vs-text">
            Have a physical Bible?
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-vs-text-secondary">
            Snap a photo to find any page or passage
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-vs-primary">
        Open Camera
        <ChevronRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}
