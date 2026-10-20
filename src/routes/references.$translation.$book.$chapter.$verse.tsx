import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SampleBadge } from "@/components/chapter-reader-parts";
import { SheetFrame } from "@/components/chapter-sheets";
import { MORE_BUTTON_CLASS } from "@/components/reflection-parts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CompareArrowsIcon,
  CopyDocIcon,
  HeartIcon,
  LightbulbIcon,
  SunIcon,
  TuneIcon,
} from "@/components/stitch-icons";
import { groupOfBook } from "@/lib/bible/book-groups";
import { findBook } from "@/lib/bible/books";
import {
  getCrossReferences,
  passageLabel,
  type CrossGroup,
  type CrossPassage,
} from "@/lib/bible/cross-reference-sample";
import { bibleService } from "@/lib/bible/service";
import type { Verse } from "@/lib/bible/types";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/copy-text";
import { library } from "@/lib/library";
import { trackEvent } from "@/lib/analytics";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { cn } from "@/lib/utils";

/*
 * Scriptural Cross References Explorer — Stitch "27". Thematic groups of related passages for an
 * anchor verse. The groups are sample content (Romans 12:2 only for now); every passage's text is
 * fetched live in the reader's translation, and words it shares with the anchor are highlighted.
 */

export const Route = createFileRoute("/references/$translation/$book/$chapter/$verse")({
  head: ({ params }) => ({
    meta: [
      {
        title: `Cross references · ${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse} — Verse Snap`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReferencesPage,
});

const STOPWORDS = new Set(
  "a an and are as at be but by for from he her his i in is it its of on or our that the their them they this to unto was we were what which who will with ye you your not".split(
    " ",
  ),
);
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}’']+/gu) ?? [];

const GROUP_ICONS: Record<CrossGroup["icon"], ReactNode> = {
  mind: <LightbulbIcon className="h-5 w-5" />,
  world: <SunIcon className="h-5 w-5" />,
  offering: <HeartIcon className="h-5 w-5" />,
};
const GROUP_TINT: Record<CrossGroup["icon"], string> = {
  mind: "bg-brand-primary-soft text-brand-primary",
  world: "bg-brand-gold-soft text-brand-gold-text",
  offering: "bg-brand-teal-soft text-brand-teal-text",
};

function Shared({ text, anchor }: { text: string; anchor: Set<string> }) {
  const parts = text.split(/([\p{L}’']+)/u);
  return (
    <>
      {parts.map((part, index) => {
        const lower = part.toLowerCase();
        return /\p{L}/u.test(part) &&
          lower.length > 2 &&
          !STOPWORDS.has(lower) &&
          anchor.has(lower) ? (
          <mark key={index} className="rounded bg-hl-amber/80 px-0.5 text-brand-text">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </>
  );
}

function ReferencesPage() {
  const params = Route.useParams();
  const goBack = useBackOrHome();
  const book = findBook(params.book);
  const anchorRef = {
    bookId: params.book,
    bookName: book?.name ?? params.book,
    chapter: Number(params.chapter),
    verse: Number(params.verse),
  };
  const anchorLabel = `${anchorRef.bookName} ${anchorRef.chapter}:${anchorRef.verse}`;
  const set = getCrossReferences(params.book, anchorRef.chapter, anchorRef.verse);
  const groups = set?.groups ?? [];
  const total = groups.reduce((sum, group) => sum + group.passages.length, 0);

  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].id] : []));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const anchor = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(anchorRef, params.translation),
    retry: 1,
  });
  const anchorWords = new Set(tokens(anchor.data?.text ?? ""));

  const visible = groups.filter((group) => !hidden.has(group.id));
  const toggleGroup = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-h-dvh bg-brand-canvas font-stitch text-brand-text">
      <header className="sticky top-0 z-40 bg-brand-canvas/85 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-2 px-5">
          <button
            type="button"
            aria-label="Go back"
            onClick={goBack}
            className={`-ml-1 ${MORE_BUTTON_CLASS}`}
          >
            <ArrowLeftIcon className="h-[22px] w-[22px]" />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-medium">
            Scriptural Cross References Explorer
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3">
        <section className="mb-4 rounded-2xl border border-brand-border bg-brand-surface p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-brand-primary-soft px-3 py-1 text-[12px] font-semibold text-brand-primary">
              <BookOpenIcon className="h-3.5 w-3.5" aria-hidden />
              {anchorLabel} · Anchor Passage
            </span>
            {groups.length > 0 ? (
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                aria-haspopup="dialog"
                className="flex items-center gap-1 rounded-full border border-brand-border px-3 py-1 text-[12px] font-medium text-brand-text-muted transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
              >
                <TuneIcon className="h-3.5 w-3.5" />
                Filter ({visible.reduce((sum, group) => sum + group.passages.length, 0)})
              </button>
            ) : null}
          </div>
          <h2 className="mt-3 flex items-center gap-2 font-display text-2xl font-semibold leading-tight">
            {set?.theme ?? anchorLabel}
            {set ? <SampleBadge /> : null}
          </h2>
          {set ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-brand-text-muted">
              {set.summary}
            </p>
          ) : null}
          {anchor.data ? (
            <p className="mt-3 border-l-2 border-brand-gold pl-3 font-display text-[15px] italic leading-relaxed text-brand-text">
              “{anchor.data.text}”
            </p>
          ) : null}
        </section>

        {groups.length === 0 ? (
          <p className="rounded-2xl bg-brand-surface-muted p-5 text-center text-[14px] leading-relaxed text-brand-text-muted">
            Cross-references for this verse aren’t available yet. Try Romans 12:2 to see how the
            explorer will work.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((group) => {
              const expanded = open.has(group.id);
              return (
                <section
                  key={group.id}
                  className="overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-sm"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          GROUP_TINT[group.icon],
                        )}
                        aria-hidden
                      >
                        {GROUP_ICONS[group.icon]}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-brand-text">
                          {group.title}
                        </span>
                        <span className="block text-[12px] text-brand-text-muted">
                          {group.passages.length} connected passages
                        </span>
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        "h-5 w-5 shrink-0 text-brand-text-muted transition-transform",
                        expanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                  {expanded ? (
                    <ul className="flex flex-col gap-3 border-t border-brand-border p-3">
                      {group.passages.map((passage) => (
                        <li key={passageLabel(passage)}>
                          <PassageCard
                            passage={passage}
                            translation={params.translation}
                            anchor={anchorWords}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-brand-canvas via-brand-canvas/95 to-transparent px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <Link
          to="/compare/$translation/$book/$chapter/$verse"
          params={params}
          className="mx-auto flex max-w-xl items-center justify-center gap-2 rounded-full bg-brand-primary py-3.5 text-[15px] font-semibold text-brand-on-primary shadow-lg transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas"
        >
          <CompareArrowsIcon className="h-5 w-5" />
          Open Parallel Study Mode
        </Link>
      </div>

      <SheetFrame
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="Filter themes"
        description={`${total} connected passages`}
      >
        <ul className="divide-y divide-brand-border pb-2">
          {groups.map((group) => {
            const on = !hidden.has(group.id);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={on && visible.length === 1}
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus disabled:opacity-60"
                >
                  <span className="text-sm font-semibold text-brand-text">
                    {group.title}{" "}
                    <span className="font-normal text-brand-text-muted">
                      ({group.passages.length})
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-md border",
                      on
                        ? "border-brand-primary bg-brand-primary text-brand-on-primary"
                        : "border-brand-border-strong text-transparent",
                    )}
                  >
                    <CheckIcon className="h-3 w-3" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </SheetFrame>
    </div>
  );
}

function PassageCard({
  passage,
  translation,
  anchor,
}: {
  passage: CrossPassage;
  translation: string;
  anchor: Set<string>;
}) {
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const numbers = Array.from({ length: passage.to - passage.from + 1 }, (_, i) => passage.from + i);
  const results = useQueries({
    queries: numbers.map((verse) => ({
      queryKey: ["verse", translation, passage.book, String(passage.chapter), String(verse)],
      queryFn: () =>
        bibleService.getVerse(
          { bookId: passage.book, bookName: passage.bookName, chapter: passage.chapter, verse },
          translation,
        ),
      retry: 1,
    })),
  });
  const verses = results
    .map((result) => result.data)
    .filter((item): item is Verse => Boolean(item));
  const text = verses.map((verse) => verse.text).join(" ");
  const first = verses[0];
  const label = passageLabel(passage);
  const category = groupOfBook(passage.book)?.label ?? "Scripture";

  const firstRef = {
    bookId: passage.book,
    bookName: passage.bookName,
    chapter: passage.chapter,
    verse: passage.from,
  };
  const { data: saved } = useQuery({
    queryKey: [
      "saved",
      "is",
      user?.id,
      translation,
      passage.book,
      String(passage.chapter),
      String(passage.from),
    ],
    queryFn: () => library.isSaved(firstRef, translation, user?.id),
    enabled: !loading,
  });
  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!first) return;
      if (saved) await library.unsave(firstRef, translation, user?.id);
      else await library.save(first, user?.id);
    },
    onSuccess: () => {
      if (!saved) trackEvent("verse_saved");
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(
        saved
          ? "Removed from saved"
          : `${passage.bookName} ${passage.chapter}:${passage.from} saved`,
      );
    },
    onError: () => toast("Could not update saved verses"),
  });

  return (
    <article className="rounded-xl bg-brand-surface-muted p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-brand-text">{label}</h3>
          <span className="mt-0.5 inline-block rounded-full bg-brand-surface px-2 py-0.5 text-[10.5px] font-semibold text-brand-gold-text">
            {passage.link}
          </span>
        </div>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={saved ? `Remove ${label} from saved` : `Save ${label}`}
            aria-pressed={Boolean(saved)}
            disabled={!first || toggleSave.isPending}
            onClick={() => toggleSave.mutate()}
            className="flex h-9 w-9 items-center justify-center rounded-full text-brand-text-muted transition-colors hover:bg-brand-surface hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-40"
          >
            <BookmarkIcon className="h-[18px] w-[18px]" filled={Boolean(saved)} />
          </button>
          <button
            type="button"
            aria-label={`Copy ${label}`}
            disabled={!text}
            onClick={() =>
              void copyText(`${label} (${translation})\n${text}`).then(
                () => toast("Copied"),
                () => toast("Could not copy"),
              )
            }
            className="flex h-9 w-9 items-center justify-center rounded-full text-brand-text-muted transition-colors hover:bg-brand-surface hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-40"
          >
            <CopyDocIcon className="h-[18px] w-[18px]" />
          </button>
        </span>
      </div>
      <p className="mt-2 font-display text-[16.5px] leading-relaxed text-brand-text">
        {text ? (
          <>
            “<Shared text={text} anchor={anchor} />”
          </>
        ) : results.some((result) => result.isLoading) ? (
          <span className="text-[14px] text-brand-text-muted">Finding passage…</span>
        ) : (
          <span className="text-[14px] text-brand-text-muted">
            Couldn’t load this passage right now.
          </span>
        )}
      </p>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11.5px] text-brand-text-muted">
          {category} · {translation}
        </span>
        <Link
          to="/verse/$translation/$book/$chapter/$verse"
          params={{
            translation,
            book: passage.book,
            chapter: String(passage.chapter),
            verse: String(passage.from),
          }}
          className="flex items-center gap-1 rounded-sm text-[12.5px] font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          Read Passage <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
