import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { getLastRead } from "@/lib/last-read";
import {
  BookmarkIcon,
  BookOpenIcon,
  ClockIcon,
  GearIcon,
  HomeIcon,
} from "@/components/stitch-icons";

// Stitch tab bar (checked against the Home, Saved and Settings designs): five tabs, 10px labels,
// muted when idle, forest green and semibold when active.
const TAB_CLASS =
  "flex min-h-12 w-full flex-col items-center justify-center gap-1 text-vs-text-secondary transition-colors hover:text-vs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[status=active]:text-vs-primary [&[data-status=active]>span]:font-semibold";
const LABEL_CLASS = "text-[10px] font-medium leading-none tracking-tight";
const ICON_CLASS = "h-5 w-5";

function ReadTab() {
  const navigate = useNavigate();
  const [lastRead] = useState(() => getLastRead());
  // The reader, single verse page, book index and reflection journal all count as "Read".
  const active = useRouterState({
    select: (state) => /^\/(chapter|verse|books|reflect)(\/|$)/.test(state.location.pathname),
  });

  return (
    <button
      type="button"
      data-status={active ? "active" : undefined}
      aria-current={active ? "page" : undefined}
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
      <BookOpenIcon className={ICON_CLASS} />
      <span className={LABEL_CLASS}>Read</span>
    </button>
  );
}

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-vs-border bg-vs-bg/95 font-stitch backdrop-blur-md">
      <ul className="mx-auto grid max-w-[30rem] grid-cols-5 px-4 pt-0.5 pb-[max(0.125rem,env(safe-area-inset-bottom))]">
        <li>
          <Link to="/" activeOptions={{ exact: true }} className={TAB_CLASS}>
            {({ isActive }) => (
              <>
                <HomeIcon filled={isActive} className={ICON_CLASS} />
                <span className={LABEL_CLASS}>Home</span>
              </>
            )}
          </Link>
        </li>
        <li>
          <ReadTab />
        </li>
        <li>
          <Link to="/saved" activeOptions={{ exact: false }} className={TAB_CLASS}>
            {({ isActive }) => (
              <>
                <BookmarkIcon filled={isActive} className={ICON_CLASS} />
                <span className={LABEL_CLASS}>Saved</span>
              </>
            )}
          </Link>
        </li>
        <li>
          <Link to="/history" activeOptions={{ exact: false }} className={TAB_CLASS}>
            {({ isActive }) => (
              <>
                <ClockIcon className={ICON_CLASS} strokeWidth={isActive ? 2 : 1.8} />
                <span className={LABEL_CLASS}>History</span>
              </>
            )}
          </Link>
        </li>
        <li>
          <Link to="/settings" activeOptions={{ exact: false }} className={TAB_CLASS}>
            {({ isActive }) => (
              <>
                <GearIcon className={ICON_CLASS} strokeWidth={isActive ? 2 : 1.8} />
                <span className={LABEL_CLASS}>Settings</span>
              </>
            )}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
