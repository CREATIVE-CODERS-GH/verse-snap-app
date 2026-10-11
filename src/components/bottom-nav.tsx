import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, BookOpenText, Clock, Home, Settings } from "lucide-react";
import { useState } from "react";
import { getLastRead } from "@/lib/last-read";

const TAB_CLASS =
  "relative flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[status=active]:font-medium data-[status=active]:text-primary after:absolute after:top-0 after:h-0.5 after:w-8 after:bg-transparent data-[status=active]:after:bg-primary";

const ITEMS = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/saved", label: "Saved", icon: Bookmark, exact: false },
  { to: "/history", label: "History", icon: Clock, exact: false },
  { to: "/settings", label: "Settings", icon: Settings, exact: false },
] as const;

function ReadTab() {
  const navigate = useNavigate();
  const [lastRead] = useState(() => getLastRead());

  return (
    <button
      type="button"
      className={TAB_CLASS}
      onClick={() =>
        navigate({
          to: "/chapter/$translation/$book/$chapter",
          params: {
            translation: lastRead.translation,
            book: lastRead.bookId,
            chapter: String(lastRead.chapter),
          },
        })
      }
    >
      <BookOpenText className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      <span>Read</span>
    </button>
  );
}

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-[2px]">
      <ul className="mx-auto grid max-w-[30rem] grid-cols-5">
        <li>
          <Link to="/" activeOptions={{ exact: true }} className={TAB_CLASS}>
            <Home className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            <span>Home</span>
          </Link>
        </li>
        <li>
          <ReadTab />
        </li>
        <li>
          <Link to="/saved" activeOptions={{ exact: false }} className={TAB_CLASS}>
            <Bookmark className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            <span>Saved</span>
          </Link>
        </li>
        <li>
          <Link to="/history" activeOptions={{ exact: false }} className={TAB_CLASS}>
            <Clock className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            <span>History</span>
          </Link>
        </li>
        <li>
          <Link to="/settings" activeOptions={{ exact: false }} className={TAB_CLASS}>
            <Settings className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            <span>Settings</span>
          </Link>
        </li>
      </ul>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
