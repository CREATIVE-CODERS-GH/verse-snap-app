import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";

interface AppShellProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** "stitch" is the rebuilt frame from the approved designs; screens opt in as they are converted. */
  variant?: "default" | "stitch";
  /** Stitch frame only: a full-width top bar rendered above the content (e.g. back button and title). */
  header?: ReactNode;
  /** Stitch frame only: leave out the bottom tab bar (pushed screens such as Search). */
  hideNav?: boolean;
}

/**
 * Mobile-first frame: a single reading column, centred on larger screens,
 * with the bottom navigation pinned below.
 */
export function AppShell({
  title,
  action,
  children,
  variant = "default",
  header,
  hideNav = false,
}: AppShellProps) {
  if (variant === "stitch") {
    const bottom = hideNav
      ? "pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      : "pb-[calc(6rem+env(safe-area-inset-bottom))]";
    const top = header ? "" : "pt-[env(safe-area-inset-top)]";
    return (
      <div className={`flex min-h-dvh flex-col bg-vs-bg font-stitch text-vs-text ${top} ${bottom}`}>
        {header}
        <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col px-6">{children}</div>
        {hideNav ? null : <BottomNav />}
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background pb-24 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto w-full max-w-[30rem] px-5">
        {title ? (
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-4 pt-7">
            <h1 className="truncate font-serif text-2xl font-semibold tracking-tight">{title}</h1>
            {action}
          </header>
        ) : null}
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
