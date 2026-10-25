import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ActionCard } from "@/components/action-card";
import { AppShell } from "@/components/app-shell";
import { BrandMark } from "@/components/brand-mark";
import {
  hasCompletedOnboarding,
  Onboarding,
  resetOnboardingFromUrl,
} from "@/components/onboarding";
import { HomeNotices } from "@/components/home-notices";
import { CameraIcon, MicIcon, SearchIcon } from "@/components/stitch-icons";
import { trackEvent } from "@/lib/analytics";

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

function HomePage() {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    resetOnboardingFromUrl();
    setShowOnboarding(!hasCompletedOnboarding());
    trackEvent("app_open");
  }, []);

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
    <AppShell variant="stitch">
      <header className="flex items-center justify-between pb-2 pt-6">
        <div className="flex items-center gap-2">
          <BrandMark className="h-7 w-7" />
          <h1 className="text-base font-semibold tracking-tight text-vs-text">Verse Snap</h1>
        </div>
      </header>

      <section className="pb-1 pt-4 text-center">
        <h2 className="font-display text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-vs-text">
          Find your verse.
          <br />
          Instantly.
        </h2>
      </section>

      <HomeNotices />

      <section className="mt-4 flex flex-1 flex-col gap-3.5 pb-2" aria-label="Ways to find a verse">
        <ActionCard
          to="/voice"
          tone="voice"
          icon={<MicIcon className="h-7 w-7" />}
          title="Say a Verse"
          description="Speak a Bible reference."
        />
        <ActionCard
          to="/scan"
          tone="camera"
          icon={<CameraIcon className="h-7 w-7" />}
          title="Snap a Verse"
          description="Point your camera at a Bible reference."
        />
        <ActionCard
          to="/search"
          tone="search"
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search the Bible"
          description="Enter a reference or describe a verse."
        />
      </section>
    </AppShell>
  );
}
