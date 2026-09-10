import { Link } from "@tanstack/react-router";
import { Bookmark, Clock, Home, Settings } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/saved", label: "Saved", icon: Bookmark, exact: false },
  { to: "/history", label: "History", icon: Clock, exact: false },
  { to: "/settings", label: "Settings", icon: Settings, exact: false },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-[2px]">
      <ul className="mx-auto grid max-w-[30rem] grid-cols-4">
        {ITEMS.map(({ to, label, icon: Icon, exact }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact }}
              className="flex min-h-[3.5rem] flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
