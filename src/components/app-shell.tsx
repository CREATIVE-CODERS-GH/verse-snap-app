import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";

interface AppShellProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Mobile-first frame: a single reading column, centred on larger screens,
 * with the bottom navigation pinned below.
 */
export function AppShell({ title, action, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background pb-24">
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
