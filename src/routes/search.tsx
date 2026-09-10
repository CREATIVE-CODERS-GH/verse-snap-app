import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { classifyQuery } from "@/lib/bible/classify-query";
import { searchScripture } from "@/lib/bible/search.functions";
import { bibleService } from "@/lib/bible/service";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const value = search["q"];
    return typeof value === "string" && value.trim() ? { q: value } : {};
  },
  head: () => ({
    meta: [
      { title: "Search the Bible — Verse Snap" },
      {
        name: "description",
        content: "Enter a reference such as John 3:16, or describe the verse you remember.",
      },
      { property: "og:title", content: "Search the Bible — Verse Snap" },
      {
        property: "og:description",
        content: "Enter a reference such as John 3:16, or describe the verse you remember.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SearchPage,
});

const EXAMPLES = [
  "John 3:16",
  "Romans 8:28",
  "I can do all things through Christ",
  "the verse about renewing your mind",
  "Psalm 23:1",
];
const FALLBACK_EXAMPLES = [
  "love is patient",
  "verse about renewing your mind",
  "be strong and courageous",
];

function SearchPage() {
  const { q } = Route.useSearch();
  const [query, setQuery] = useState(q ?? "");
  const [submitted, setSubmitted] = useState(q ?? "");
  const { translation } = usePreferences();
  const navigate = useNavigate();
  const runSearch = useServerFn(searchScripture);
  const result = useMemo(() => bibleService.parseReference(query), [query]);
  const trimmed = query.trim();

  useEffect(() => {
    if (q) {
      setQuery(q);
      setSubmitted(q);
    }
  }, [q]);

  const description = useMemo(() => {
    const intent = submitted ? classifyQuery(submitted) : null;
    return intent?.kind === "description" ? intent.query : "";
  }, [submitted]);

  const search = useQuery({
    queryKey: ["scripture-search", description, translation],
    queryFn: () => runSearch({ data: { query: description, translation } }),
    enabled: description.length > 0,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const openReference = (reference: NonNullable<typeof result>) => {
    if (reference.verse === undefined) {
      navigate({
        to: "/chapter/$translation/$book/$chapter",
        params: { translation, book: reference.bookId, chapter: String(reference.chapter) },
      });
      return;
    }
    navigate({
      to: "/verse/$translation/$book/$chapter/$verse",
      params: {
        translation,
        book: reference.bookId,
        chapter: String(reference.chapter),
        verse: String(reference.verse),
      },
    });
  };

  const results = search.data?.results ?? [];
  const failed = search.isError || search.data?.failed === true;

  return (
    <AppShell title="Search the Bible">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          const intent = classifyQuery(trimmed);
          if (intent?.kind === "reference") {
            openReference(intent.reference);
            return;
          }
          setSubmitted(trimmed);
          navigate({ to: "/search", search: { q: trimmed }, replace: true });
        }}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Enter a reference or describe a verse..."
          aria-label="Bible reference or description"
          autoComplete="off"
          maxLength={500}
          className="h-12 rounded-md pl-9 text-base"
        />
      </form>

      <div className="mt-6">
        {result ? (
          <Link
            to={
              result.verse === undefined
                ? "/chapter/$translation/$book/$chapter"
                : "/verse/$translation/$book/$chapter/$verse"
            }
            params={
              result.verse === undefined
                ? { translation, book: result.bookId, chapter: String(result.chapter) }
                : {
                    translation,
                    book: result.bookId,
                    chapter: String(result.chapter),
                    verse: String(result.verse),
                  }
            }
            className="flex items-center justify-between border-y border-border py-4"
          >
            <span>
              <span className="block text-[0.9375rem] font-medium">
                {result.bookName} {result.chapter}
                {result.verse === undefined ? "" : `:${result.verse}`}
              </span>
              <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                {translation}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : description ? (
          <section aria-live="polite">
            {search.isPending ? (
              <p className="text-[0.9375rem] text-muted-foreground">Finding verses…</p>
            ) : failed ? (
              <div>
                <p className="text-[0.9375rem]">
                  {search.data?.errorMessage ?? "Couldn't complete that search."}
                </p>
                <p className="mt-1 text-[0.9375rem] text-muted-foreground">
                  Try again, or search by reference.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => void search.refetch()}
                >
                  Search again
                </Button>
              </div>
            ) : results.length === 0 ? (
              <div>
                <p className="text-[0.9375rem]">Try describing the verse differently.</p>
                <p className="mt-1 text-[0.9375rem] text-muted-foreground">
                  For example:
                </p>
                <ul className="mt-2 text-[0.875rem] text-muted-foreground">
                  {FALLBACK_EXAMPLES.map((example) => (
                    <li key={example}>“{example}”</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => void search.refetch()}
                >
                  Search again
                </Button>
              </div>
            ) : (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                  Relevant verses
                </h2>
                <ul className="mt-1">
                  {results.map((item) => (
                    <li
                      key={`${item.bookId}-${item.chapter}-${item.verse}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <Link
                        to="/verse/$translation/$book/$chapter/$verse"
                        params={{
                          translation,
                          book: item.bookId,
                          chapter: String(item.chapter),
                          verse: String(item.verse),
                        }}
                        className="flex items-center gap-2 py-3.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.9375rem] font-medium">
                            {item.reference}
                          </span>
                          <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                            {item.translation}
                          </span>
                          <span className="mt-1 block truncate font-serif text-sm text-muted-foreground">
                            {item.text}
                          </span>
                        </span>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : trimmed.length > 2 ? (
          <p className="text-[0.9375rem] text-muted-foreground">
            Press enter to search for a verse like this, or enter a reference such as John 3:16.
          </p>
        ) : (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
              Try
            </h2>
            <ul className="mt-1">
              {EXAMPLES.map((example) => (
                <li key={example} className="border-b border-border last:border-b-0">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setQuery(example)}
                    className="h-auto min-h-12 w-full justify-start rounded-none px-0 py-3.5 text-left text-[0.9375rem] font-normal"
                  >
                    {example}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
