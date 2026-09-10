import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Mic, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { VerseRow } from "@/components/verse-row";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";

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
  const { user } = useAuth();

  const { data: recent } = useQuery({
    queryKey: ["history", "recent", user?.id],
    queryFn: () => library.listHistory(4, user?.id),
  });

  const items = recent ?? [];

  return (
    <AppShell>
      <header className="pt-10">
        <h1 className="font-serif text-[1.75rem] font-semibold tracking-tight">Verse Snap</h1>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">Find your verse. Instantly.</p>
      </header>

      <div className="mt-8 space-y-3">
        <Button asChild className="h-14 w-full justify-center gap-2.5 text-base">
          <Link to="/voice">
            <Mic className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            Say a Verse
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-12 w-full justify-center gap-2.5 border-border bg-transparent text-[0.9375rem]"
        >
          <Link to="/scan">
            <Camera className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
            Snap a Verse
          </Link>
        </Button>
        <Link
          to="/search"
          className="flex items-center justify-center gap-2 py-2 text-[0.9375rem] text-primary underline-offset-4 hover:underline"
        >
          <Search className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          Search the Bible
        </Link>
      </div>

      <section className="mt-10">
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
    </AppShell>
  );
}
