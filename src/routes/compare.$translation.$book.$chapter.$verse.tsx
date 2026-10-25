import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SampleBadge } from "@/components/chapter-reader-parts";
import { SheetFrame } from "@/components/chapter-sheets";
import { MORE_BUTTON_CLASS } from "@/components/reflection-parts";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyDocIcon,
  MoreHorizIcon,
  PagesIcon,
  PlusIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { findBook } from "@/lib/bible/books";
import { getRootNotes, TRANSLATION_APPROACH } from "@/lib/bible/compare-sample";
import { bibleService } from "@/lib/bible/service";
import { BIBLE_TRANSLATIONS, translationName } from "@/lib/bible/translations";
import type { Verse } from "@/lib/bible/types";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/copy-text";
import { library } from "@/lib/library";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { useSpeak } from "@/lib/use-speak";
import { cn } from "@/lib/utils";

/*
 * Multi-Translation Comparison — Stitch "25". One verse in several editions from the app's
 * catalogue. Wording that differs from your default edition is highlighted automatically; the
 * original-language card has notes for Romans 12:2 only (labelled sample content).
 */

export const Route = createFileRoute("/compare/$translation/$book/$chapter/$verse")({
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse}`;
    return {
      meta: [
        { title: `Compare ${reference} — Verse Snap` },
        { name: "description", content: `${reference} side by side in several translations.` },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: ComparePage,
});

const MAX_DEFAULT_EDITIONS = 4;
const STOPWORDS = new Set(
  "a an and are as at be but by for from he her his i in is it its of on or our that the their them they this to unto was we were what which who will with ye you your".split(
    " ",
  ),
);

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}’']+/gu) ?? [];
}

/** Splits text into tokens and marks words that the base edition does not use. */
function DiffText({ text, base }: { text: string; base: Set<string> | null }) {
  if (!base) return <>{text}</>;
  const parts = text.split(/([\p{L}’']+)/u);
  return (
    <>
      {parts.map((part, index) => {
        const lower = part.toLowerCase();
        const differs =
          /[\p{L}]/u.test(part) && !STOPWORDS.has(lower) && lower.length > 2 && !base.has(lower);
        return differs ? (
          <mark key={index} className="rounded bg-hl-amber/80 px-0.5 font-semibold text-brand-text">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </>
  );
}

function ComparePage() {
  const params = Route.useParams();
  const goBack = useBackOrHome();
  const prefs = usePreferences();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const book = findBook(params.book);
  const ref = {
    bookId: params.book,
    bookName: book?.name ?? params.book,
    chapter: Number(params.chapter),
    verse: Number(params.verse),
  };
  const reference = `${ref.bookName} ${ref.chapter}:${ref.verse}`;

  const { data: catalogue } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });
  const editions = catalogue ?? BIBLE_TRANSLATIONS;

  // Default edition first (your saved translation), then the one you were reading, then others.
  const defaultCode = prefs.translation;
  const initial = useMemo(() => {
    const order = [defaultCode, params.translation, ...editions.map((item) => item.code)];
    return [...new Set(order)]
      .filter((code) => editions.some((item) => item.code === code))
      .slice(0, MAX_DEFAULT_EDITIONS);
  }, [defaultCode, params.translation, editions]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const shown = chosen ?? initial;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [rootsOpen, setRootsOpen] = useState(true);
  const speech = useSpeak((message) => toast(message));

  const results = useQueries({
    queries: shown.map((code) => ({
      // Same key as the verse page, so a verse already fetched there is reused.
      queryKey: ["verse", code, params.book, params.chapter, params.verse],
      queryFn: () => bibleService.getVerse(ref, code),
      retry: 1,
    })),
  });
  const verseFor = (code: string): Verse | undefined =>
    results[shown.indexOf(code)]?.data ?? undefined;
  const baseVerse = verseFor(defaultCode) ?? verseFor(shown[0] ?? "");
  const baseWords = baseVerse ? new Set(words(baseVerse.text)) : null;

  const notes = getRootNotes(params.book, ref.chapter, ref.verse);

  const verseRef = {
    bookId: ref.bookId,
    bookName: ref.bookName,
    chapter: ref.chapter,
    verse: ref.verse,
  };
  const { data: saved } = useQuery({
    queryKey: [
      "saved",
      "is",
      user?.id,
      params.translation,
      params.book,
      params.chapter,
      params.verse,
    ],
    queryFn: () => library.isSaved(verseRef, params.translation, user?.id),
    enabled: !authLoading,
  });
  const toggleSave = useMutation({
    mutationFn: async () => {
      const verse = verseFor(params.translation) ?? baseVerse;
      if (!verse) return;
      if (saved) await library.unsave(verseRef, params.translation, user?.id);
      else await library.save(verse, user?.id);
    },
    onSuccess: () => {
      if (!saved) trackEvent("verse_saved");
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(saved ? "Removed from saved" : "Saved");
    },
    onError: () => toast("Could not update saved verses"),
  });

  const copyVerse = async (verse: Verse) => {
    try {
      await copyText(`${verse.reference} (${verse.translation})\n${verse.text}`);
      trackEvent("verse_copied");
      toast("Copied");
    } catch {
      toast("Could not copy this verse");
    }
  };

  const loaded = shown.map((code) => verseFor(code)).filter((item): item is Verse => Boolean(item));
  const listenAll = () =>
    speech.toggle(
      [
        reference,
        ...loaded.map((verse) => `${translationName(verse.translation)}. ${verse.text}`),
      ].join(". "),
    );
  const copyAll = () =>
    void copyText(
      [reference, ...loaded.map((verse) => `${verse.translation}: ${verse.text}`)].join("\n\n"),
    ).then(
      () => toast("All translations copied"),
      () => toast("Could not copy"),
    );

  return (
    <div className="min-h-dvh bg-brand-canvas font-stitch text-brand-text">
      <header className="fixed inset-x-0 top-0 z-50 bg-brand-canvas/85 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              aria-label="Go back"
              onClick={goBack}
              className={`-ml-1 ${MORE_BUTTON_CLASS}`}
            >
              <ArrowLeftIcon className="h-[22px] w-[22px]" />
            </button>
            <h1 className="truncate pr-2 font-display text-xl font-medium leading-7">
              Multi Translation Comparison View
            </h1>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" aria-label="More options" className={MORE_BUTTON_CLASS}>
                <MoreHorizIcon className="h-[22px] w-[22px]" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-[70] min-w-52 rounded-2xl border border-brand-border bg-brand-surface p-1.5 font-stitch text-brand-text shadow-xl"
              >
                <DropdownMenu.Item
                  onSelect={copyAll}
                  className="flex cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-brand-surface-muted"
                >
                  Copy all translations
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  asChild
                  className="flex cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-brand-surface-muted"
                >
                  <Link to="/chapter/$translation/$book/$chapter" params={params}>
                    Open the chapter
                  </Link>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(4.5rem+env(safe-area-inset-top))]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-lg font-semibold leading-tight">{reference}</p>
            <p className="text-[11px] font-medium text-brand-text-muted">
              {shown.length} Translations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={listenAll}
              aria-pressed={speech.speaking}
              disabled={loaded.length === 0}
              className="flex items-center gap-1.5 rounded-full bg-brand-primary-soft px-3 py-1.5 text-[13px] font-medium text-brand-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-50"
            >
              {speech.speaking ? (
                <StopSquareIcon className="h-4 w-4" />
              ) : (
                <VolumeIcon className="h-4 w-4" />
              )}
              {speech.speaking ? "Stop" : "Listen All"}
            </button>
            <button
              type="button"
              onClick={() => setVersionsOpen(true)}
              aria-haspopup="dialog"
              className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
            >
              <PlusIcon className="h-4 w-4" />
              Version
            </button>
          </div>
        </div>
        {shown.length > 1 ? (
          <p className="mb-4 text-[11.5px] text-brand-text-muted">
            Words that differ from your default ({defaultCode}) are highlighted.
          </p>
        ) : null}

        <ol className="flex flex-col gap-4">
          {shown.map((code, index) => {
            const result = results[index];
            const verse = result?.data;
            const isDefault = code === defaultCode;
            return (
              <li key={code}>
                <article className="rounded-2xl border border-brand-border bg-brand-surface p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          isDefault
                            ? "bg-brand-primary text-brand-on-primary"
                            : "bg-brand-surface-strong text-brand-text-muted",
                        )}
                      >
                        {code}
                      </span>
                      <span className="truncate text-[13px] font-medium text-brand-text">
                        {translationName(code)}
                      </span>
                    </span>
                    {isDefault ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand-primary">
                        <CheckIcon className="h-3.5 w-3.5" /> Default
                      </span>
                    ) : null}
                  </div>
                  <p className="font-display text-[19px] leading-relaxed text-brand-text">
                    {result?.isLoading ? (
                      <span className="text-[15px] text-brand-text-muted">Finding verse…</span>
                    ) : verse ? (
                      <>
                        “<DiffText text={verse.text} base={isDefault ? null : baseWords} />”
                      </>
                    ) : (
                      <span className="text-[15px] text-brand-text-muted">
                        {result?.isError
                          ? "Couldn’t load this edition right now."
                          : "This verse isn’t in this edition."}
                      </span>
                    )}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-brand-text-muted">
                      {TRANSLATION_APPROACH[code] ?? "Bible translation"}
                    </span>
                    <span className="flex items-center gap-1">
                      <IconAction
                        label={`Listen to ${code}`}
                        disabled={!verse}
                        onClick={() => verse && speech.toggle(`${verse.reference}. ${verse.text}`)}
                      >
                        <VolumeIcon className="h-[18px] w-[18px]" />
                      </IconAction>
                      <IconAction
                        label={`Copy ${code}`}
                        disabled={!verse}
                        onClick={() => verse && void copyVerse(verse)}
                      >
                        <CopyDocIcon className="h-[18px] w-[18px]" />
                      </IconAction>
                    </span>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>

        <section className="mt-5 rounded-2xl border border-brand-border bg-brand-surface shadow-sm">
          <button
            type="button"
            aria-expanded={rootsOpen}
            onClick={() => setRootsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus"
          >
            <span className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gold-soft text-brand-gold-text"
                aria-hidden
              >
                <PagesIcon className="h-[18px] w-[18px]" />
              </span>
              <span>
                <span className="flex items-center gap-2 text-[15px] font-semibold text-brand-text">
                  Greek Root Nuance {notes.length ? <SampleBadge /> : null}
                </span>
                <span className="block text-[12px] text-brand-text-muted">
                  Key translational divergence breakdown
                </span>
              </span>
            </span>
            <ChevronDownIcon
              className={cn(
                "h-5 w-5 text-brand-text-muted transition-transform",
                rootsOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {rootsOpen ? (
            <div className="space-y-4 border-t border-brand-border px-4 pb-4 pt-3">
              {notes.length === 0 ? (
                <p className="text-[13px] text-brand-text-muted">
                  Original-language notes for this verse aren’t available yet.
                </p>
              ) : (
                notes.map((note) => (
                  <div key={note.strongs}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="font-display text-xl font-bold text-brand-primary"
                        lang="grc"
                      >
                        {note.word}
                      </span>
                      <span className="text-[11px] text-brand-text-muted">
                        {note.strongs} • {note.form}
                      </span>
                    </div>
                    <p className="mt-1 text-[14px] font-medium text-brand-text">
                      <span className="capitalize">{note.transliteration}</span> — “{note.gloss}”
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-brand-text-muted">
                      {note.meaning}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </section>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-brand-surface-muted px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] text-brand-text">
            <BookmarkIcon
              className="h-4 w-4 text-brand-primary"
              filled={Boolean(saved)}
              aria-hidden
            />
            {saved ? "In your saved verses" : "Not saved yet"}
          </span>
          <button
            type="button"
            onClick={() => toggleSave.mutate()}
            disabled={toggleSave.isPending || !baseVerse}
            className="text-[13px] font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-50"
          >
            {saved ? "Remove" : "Save verse"}
          </button>
        </div>
      </main>

      <SheetFrame
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        title="Translations to compare"
        description="Choose up to six"
      >
        <ul className="divide-y divide-brand-border pb-2">
          {editions.map((edition) => {
            const on = shown.includes(edition.code);
            return (
              <li key={edition.code}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={on && shown.length === 1}
                  onClick={() =>
                    setChosen(
                      on
                        ? shown.filter((code) => code !== edition.code)
                        : editions
                            .map((item) => item.code)
                            .filter((code) => code === edition.code || shown.includes(code)),
                    )
                  }
                  className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus disabled:opacity-60"
                >
                  <span>
                    <span className="text-sm font-semibold text-brand-text">{edition.code}</span>
                    <span className="ml-2 text-[12px] text-brand-text-muted">{edition.name}</span>
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

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-full text-brand-text-muted transition-colors hover:bg-brand-surface-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-40"
    >
      {children}
    </button>
  );
}
