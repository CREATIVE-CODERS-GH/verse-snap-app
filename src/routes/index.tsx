import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Camera, ChevronRight, Mic, Search, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { hasCompletedOnboarding, Onboarding } from "@/components/onboarding";
import { VerseRow } from "@/components/verse-row";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";
import { findBook } from "@/lib/bible/books";
import { getStoredLastRead, type LastRead } from "@/lib/last-read";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Verse Snap — Find your verse. Instantly." },
      {
        name: "description",
        content:
          "Open any Bible verse in seconds. Search a reference, read it in clear type, and keep the verses you want to come back to.",
      },
      { property: "og:title", content: "Verse Snap — Find your verse. Instantly." },
      {
        property: "og:description",
        content: "Open any Bible verse in seconds. Search, read, save.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

interface ActionCardProps {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  bg: string;
  iconBg: string;
  heading: string;
  text: string;
}

function ActionCard({
  to,
  icon,
  title,
  description,
  bg,
  iconBg,
  heading,
  text,
}: ActionCardProps) {
  return (
    <Link
      to={to}
      className={cn(
        "action-card h-[190px] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        bg,
      )}
    >
      <span
        className={cn(
          "home-action-icon mb-2 flex h-14 w-14 items-center justify-center rounded-full text-action-icon-foreground ring-4 ring-action-icon-ring",
          iconBg,
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className={cn("font-serif text-lg font-semibold", heading)}>
        {title}
      </span>
      <span className={cn("mt-1 text-xs leading-5", text)}>{description}</span>
    </Link>
  );
}

function HomePage() {
  const { user } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [continueReading, setContinueReading] = useState<LastRead | null>(null);

  useEffect(() => {
    setShowOnboarding(!hasCompletedOnboarding());
    setContinueReading(getStoredLastRead());
    trackEvent("app_open");
  }, []);

  const { data: recent } = useQuery({
    queryKey: ["history", "recent", user?.id],
    queryFn: () => library.listHistory(4, user?.id),
  });

  const items = recent ?? [];

  if (showOnboarding === null) {
    return <div className="min-h-dvh bg-background" aria-hidden />;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={() => {
          trackEvent("onboarding_completed");
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <AppShell>
      <div className="home-page mx-auto max-w-[340px]">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          <h1 className="truncate text-base font-semibold">Verse Snap</h1>
        </div>
        <Link
          to="/settings"
          aria-label="Settings"
          className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </Link>
      </header>

      <section className="pt-4 text-center">
        <h2 className="font-serif text-[1.75rem] font-semibold leading-[1.2]">
          Find your verse.
          <br />
          Instantly.
        </h2>
      </section>

      <section className="mt-5 space-y-4" aria-label="Ways to find a verse">
        <ActionCard
          to="/voice"
          icon={<Mic className="h-7 w-7" strokeWidth={1.9} />}
          title="Say a Verse"
          description="Speak a Bible reference."
          bg="home-action-green"
          iconBg="bg-action-green-icon"
          heading="text-action-green-heading"
          text="text-action-green-text"
        />
        <ActionCard
          to="/scan"
          icon={<Camera className="h-7 w-7" strokeWidth={1.9} />}
          title="Snap a Verse"
          description="Point your camera at a Bible reference."
          bg="home-action-peach"
          iconBg="bg-gradient-to-br from-action-peach-icon to-action-peach-icon-deep"
          heading="text-action-peach-heading"
          text="text-action-peach-text"
        />
        <ActionCard
          to="/search"
          icon={<Search className="h-7 w-7" strokeWidth={2.1} />}
          title="Search the Bible"
          description="Enter a reference or describe a verse."
          bg="home-action-blue"
          iconBg="bg-gradient-to-br from-action-blue-icon to-action-blue-icon-deep"
          heading="text-action-blue-heading"
          text="text-action-blue-text"
        />
      </section>

      {continueReading ? (
        <section className="mt-8" aria-label="Continue reading">
          <Link
            to="/chapter/$translation/$book/$chapter"
            params={{
              translation: continueReading.translation,
              book: continueReading.bookId,
              chapter: String(continueReading.chapter),
            }}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                Continue reading
              </span>
              <span className="mt-1 block truncate font-serif text-base font-semibold">
                {findBook(continueReading.bookId)?.name ?? continueReading.bookId}{" "}
                {continueReading.chapter} · {continueReading.translation}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </section>
      ) : null}

      <section className="mt-12 pb-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border pb-2">
          <h2 className="truncate text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            Recent
          </h2>
          <Link to="/history" className="shrink-0 text-[0.8125rem] text-primary hover:underline">
            See all
          </Link>
        </div>
        <div>
          {items.map((item) => (
            <VerseRow
              key={`${item.bookId}-${item.chapter}-${item.verse}`}
              translation={item.translation}
              bookId={item.bookId}
              bookName={item.bookName}
              chapter={item.chapter}
              verse={item.verse}
            />
          ))}
        </div>
        {items.length === 0 ? (
          <p className="pt-3 text-[0.8125rem] text-muted-foreground">
            Verses you open will appear here.
          </p>
        ) : null}
      </section>
      </div>
    </AppShell>
  );
}
