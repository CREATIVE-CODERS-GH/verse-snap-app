import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { bibleService } from "@/lib/bible/service";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search the Bible — Verse Snap" },
      {
        name: "description",
        content: "Type a Bible reference such as John 3:16 and open the verse straight away.",
      },
      { property: "og:title", content: "Search the Bible — Verse Snap" },
      {
        property: "og:description",
        content: "Type a Bible reference such as John 3:16 and open the verse straight away.",
      },
    ],
  }),
  component: SearchPage,
});

const EXAMPLES = ["John 3:16", "Romans 8:28", "Hebrews 2:5", "Psalm 23:1", "1 Corinthians 13:4"];

function SearchPage() {
  const [query, setQuery] = useState("");
  const { translation } = usePreferences();
  const navigate = useNavigate();
  const result = useMemo(() => bibleService.parseReference(query), [query]);
  const trimmed = query.trim();

  return (
    <AppShell title="Search the Bible">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          if (!result) return;
          if (result.verse === undefined) {
            navigate({
              to: "/chapter/$translation/$book/$chapter",
              params: { translation, book: result.bookId, chapter: String(result.chapter) },
            });
          } else {
            navigate({
              to: "/verse/$translation/$book/$chapter/$verse",
              params: { translation, book: result.bookId, chapter: String(result.chapter), verse: String(result.verse) },
            });
          }
        }}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Enter a reference, e.g. John 3:16"
          aria-label="Bible reference"
          autoComplete="off"
          className="h-12 rounded-md pl-9 text-base"
        />
      </form>

      <div className="mt-6">
        {result ? (
          <Link
            to={result.verse === undefined ? "/chapter/$translation/$book/$chapter" : "/verse/$translation/$book/$chapter/$verse"}
            params={result.verse === undefined
              ? { translation, book: result.bookId, chapter: String(result.chapter) }
              : { translation, book: result.bookId, chapter: String(result.chapter), verse: String(result.verse) }}
            className="flex items-center justify-between border-y border-border py-4"
          >
            <span>
              <span className="block text-[0.9375rem] font-medium">
                {result.bookName} {result.chapter}{result.verse === undefined ? "" : `:${result.verse}`}
              </span>
              <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                {translation}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : trimmed.length > 2 ? (
          <p className="text-[0.9375rem] text-muted-foreground">
            That Bible reference doesn't look right. Try John 3:16 or Psalm 23.
          </p>
        ) : (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Try
            </h2>
            <ul className="mt-1">
              {EXAMPLES.map((example) => (
                <li key={example} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setQuery(example)}
                    className="w-full py-3.5 text-left text-[0.9375rem]"
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
