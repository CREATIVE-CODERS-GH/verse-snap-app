import { useNavigate } from "@tanstack/react-router";

export type SearchMode = "discover" | "verse-snap";

const TABS: { mode: SearchMode; label: string }[] = [
  { mode: "discover", label: "Discover" },
  { mode: "verse-snap", label: "Verse Snap" },
];

/**
 * The two search modes on the Search screen: Discover (YouVersion-powered) and Verse Snap (reference,
 * keyword and phrase search). Switching drops the typed query so neither mode starts a request the person
 * did not ask for; the mode lives in the URL (`?mode=discover`), so Back and links work.
 */
export function SearchModeSwitch({ mode }: { mode: SearchMode }) {
  const navigate = useNavigate();
  return (
    <div
      role="group"
      aria-label="Search mode"
      className="flex w-full rounded-full bg-vs-container p-1"
      data-testid="search-mode-switch"
    >
      {TABS.map((tab) => {
        const active = tab.mode === mode;
        return (
          <button
            key={tab.mode}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              navigate({
                to: "/search",
                search: tab.mode === "discover" ? { mode: "discover" } : {},
                replace: true,
              });
            }}
            className={`flex-1 rounded-full py-2 text-center text-[13px] leading-[18px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-vs-primary font-semibold text-vs-on-primary shadow-sm" : "font-medium text-vs-text-secondary hover:text-vs-text"}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
