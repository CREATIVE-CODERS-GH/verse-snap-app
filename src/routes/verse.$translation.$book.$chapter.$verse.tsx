import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  NAV_CARD_DISABLED,
  NAV_CARD_LINK,
  ReaderAction,
  ReaderHeader,
  VerseFocus,
  VerseNavCardContent,
} from "@/components/reader-parts";
import {
  ERROR_TITLE_CLASS,
  ErrorIllustration,
  LoadingState,
  NOT_FOUND_MESSAGE,
  NoResultsIllustration,
  NotFoundActions,
  PILL_OUTLINE,
  StateMessage,
} from "@/components/search-states";
import {
  ArrowRightIcon,
  CopyDocIcon,
  EditNoteIcon,
  PagesIcon,
  SaveBookmarkIcon,
  ShareNodesIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { CrossReferenceSheet } from "@/components/cross-reference-parts";
import { OfflineSwitch } from "@/components/offline-switch";
import { ShareSheet } from "@/components/share-sheet";
import { TranslationSheet } from "@/components/translation-sheet";
import { findBook } from "@/lib/bible/books";
import { rankPassages, SHEET_LIMIT } from "@/lib/bible/cross-references";
import { useVerseCrossRefs } from "@/lib/bible/use-cross-references";
import { BibleServiceError, type Verse } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { BIBLE_TRANSLATIONS, translationName } from "@/lib/bible/translations";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";
import { useBackOrHome } from "@/lib/use-back-or-home";

export const Route = createFileRoute("/verse/$translation/$book/$chapter/$verse")({
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse}`;
    return {
      meta: [
        { title: `${reference} (${params.translation}) — Verse Snap` },
        {
          name: "description",
          content: `Read ${reference} in the ${params.translation} on Verse Snap.`,
        },
        { property: "og:title", content: `${reference} — Verse Snap` },
        { property: "og:description", content: `Read ${reference} in the ${params.translation}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: VersePage,
});

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function VersePage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { playbackSpeed } = usePreferences();
  const queryClient = useQueryClient();
  const [speaking, setSpeaking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const xrefs = useVerseCrossRefs(params.book, Number(params.chapter), Number(params.verse));
  const related = rankPassages(xrefs.passages, SHEET_LIMIT);
  const recorded = useRef<string | null>(null);
  const book = findBook(params.book);
  const chapter = Number(params.chapter);
  const verseNumber = Number(params.verse);
  const validParams = Boolean(
    book &&
    Number.isInteger(chapter) &&
    chapter > 0 &&
    Number.isInteger(verseNumber) &&
    verseNumber > 0,
  );
  const ref = useMemo(
    () => ({
      bookId: params.book,
      bookName: book?.name ?? params.book,
      chapter,
      verse: verseNumber,
    }),
    [params.book, book?.name, chapter, verseNumber],
  );

  const verseQuery = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(ref, params.translation),
    enabled: validParams,
    retry: 1,
  });
  const verse = verseQuery.data;

  const { data: neighbours } = useQuery({
    queryKey: ["verse-neighbours", params.translation, params.book, params.chapter, params.verse],
    queryFn: async () => ({
      previous: await bibleService.getNeighbour(ref, -1, params.translation),
      next: await bibleService.getNeighbour(ref, 1, params.translation),
    }),
    enabled: Boolean(verse),
  });
  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });
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
    queryFn: () => library.isSaved(ref, params.translation, user?.id),
    enabled: Boolean(verse) && !authLoading,
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!verse) return;
      if (saved) await library.unsave(ref, params.translation, user?.id);
      else await library.save(verse, user?.id);
    },
    onSuccess: () => {
      if (!saved) trackEvent("verse_saved");
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(saved ? "Removed from saved" : "Saved");
    },
    onError: () => toast("Could not update saved verses"),
  });

  useEffect(() => {
    const key = `${params.translation}/${params.book}/${params.chapter}/${params.verse}/${user?.id ?? "guest"}`;
    if (!verse || authLoading || recorded.current === key) return;
    recorded.current = key;
    trackEvent("verse_opened");
    library
      .recordView(verse, user?.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["history"] }))
      .catch(() => undefined);
  }, [
    authLoading,
    user?.id,
    verse,
    params.translation,
    params.book,
    params.chapter,
    params.verse,
    queryClient,
  ]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const shareText = verse ? `${verse.reference}\n${verse.translation}\n\n${verse.text}` : "";

  async function handleCopy() {
    if (!verse) return;
    try {
      await copyText(shareText);
      trackEvent("verse_copied");
      toast("Copied");
    } catch {
      toast("Could not copy this verse");
    }
  }

  // Share opens the Share Options sheet (Stitch 13).
  function handleShare() {
    if (verse) setShareOpen(true);
  }

  function handleListen() {
    if (!verse || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      toast("Listening isn't available on this device");
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${verse.reference}. ${verse.text}`);
    utterance.rate = Number.parseFloat(playbackSpeed) || 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    trackEvent("verse_listened");
    setSpeaking(true);
  }

  const providerError = verseQuery.error instanceof BibleServiceError ? verseQuery.error : null;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const networkProblem = providerError?.kind === "network";
  const errorMessage = networkProblem
    ? offline
      ? "You’re offline, and this verse isn’t saved on this device yet. Verses you’ve opened recently are available offline — reconnect to read this one."
      : "Verse Snap couldn’t reach the Bible. Check your connection and try again."
    : providerError?.kind === "translation"
      ? "That translation isn't available."
      : "That Bible reference doesn't look right.";

  const goBack = useBackOrHome();
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const translationButtonRef = useRef<HTMLButtonElement | null>(null);
  const shownTranslation = verse?.translation ?? params.translation;

  const neighbourCard = (
    direction: "previous" | "next",
    neighbour: Verse | null | undefined,
  ): ReactNode => {
    if (!neighbour) {
      return (
        <span
          className={NAV_CARD_DISABLED}
          aria-disabled="true"
          aria-label={direction === "previous" ? "No previous verse" : "No next verse"}
        >
          <VerseNavCardContent direction={direction} reference="—" />
        </span>
      );
    }
    const reference = `${neighbour.bookName} ${neighbour.chapter}:${neighbour.verse}`;
    return (
      <Link
        to="/verse/$translation/$book/$chapter/$verse"
        params={{
          translation: params.translation,
          book: neighbour.bookId,
          chapter: String(neighbour.chapter),
          verse: String(neighbour.verse),
        }}
        aria-label={`${direction === "previous" ? "Previous" : "Next"} verse: ${reference}`}
        className={NAV_CARD_LINK}
      >
        <VerseNavCardContent direction={direction} reference={reference} />
      </Link>
    );
  };

  return (
    <>
      <AppShell
        variant="stitch"
        hideNav
        header={
          <ReaderHeader
            title={`${ref.bookName} ${ref.chapter}:${ref.verse}`}
            translation={params.translation}
            onBack={goBack}
            onOpenTranslations={() => setTranslationsOpen(true)}
            translationButtonRef={translationButtonRef}
          />
        }
      >
        <main className="-mt-4 flex flex-1 flex-col justify-center px-2 py-6">
          {verseQuery.isLoading ? (
            <LoadingState />
          ) : verse ? (
            <article className="flex flex-col items-center" aria-label={verse.reference}>
              <VerseFocus number={verse.verse} text={verse.text} />
              <p className="mt-8 text-center text-xs font-medium tracking-wide text-vs-text-secondary">
                {verse.reference} ({verse.translation})
                <span className="sr-only">, {translationName(verse.translation)}</span>
              </p>
              <div className="mt-6 flex w-full justify-center">
                <Link
                  to="/chapter/$translation/$book/$chapter"
                  params={{
                    translation: params.translation,
                    book: params.book,
                    chapter: String(ref.chapter),
                  }}
                  className="group flex items-center gap-2 rounded-full border border-vs-primary/20 bg-vs-primary/10 px-4 py-2 text-vs-primary transition-colors hover:bg-vs-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-vs-primary/20"
                >
                  <PagesIcon className="h-4 w-4" aria-hidden />
                  <span className="text-xs font-semibold tracking-wide">
                    Read in {ref.bookName} {ref.chapter}
                  </span>
                  <ArrowRightIcon
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </div>
              <div
                className="mt-6 flex w-full max-w-[280px] items-center justify-between px-2"
                role="group"
                aria-label="Verse actions"
              >
                <ReaderAction
                  label={saved ? "Saved" : "Save"}
                  pressed={Boolean(saved)}
                  icon={<SaveBookmarkIcon className="h-[19px] w-[19px]" filled={Boolean(saved)} />}
                  onClick={() => toggleSave.mutate()}
                  disabled={!verse || toggleSave.isPending}
                />
                <ReaderAction
                  label="Share"
                  icon={<ShareNodesIcon className="h-[19px] w-[19px]" />}
                  onClick={handleShare}
                  disabled={!verse}
                />
                <ReaderAction
                  label="Copy"
                  icon={<CopyDocIcon className="h-[19px] w-[19px]" />}
                  onClick={handleCopy}
                  disabled={!verse}
                />
                <ReaderAction
                  label={speaking ? "Stop" : "Listen"}
                  icon={
                    speaking ? (
                      <StopSquareIcon className="h-[19px] w-[19px]" />
                    ) : (
                      <VolumeIcon className="h-[19px] w-[19px]" />
                    )
                  }
                  onClick={handleListen}
                  disabled={!verse}
                />
                <ReaderAction
                  label="Reflect"
                  icon={<EditNoteIcon className="h-[19px] w-[19px]" />}
                  onClick={() =>
                    navigate({ to: "/reflect/$translation/$book/$chapter/$verse", params })
                  }
                  disabled={!verse}
                />
              </div>
              {xrefs.isError || xrefs.isLoading || related.total > 0 ? (
                <button
                  type="button"
                  onClick={() => setRelatedOpen(true)}
                  aria-haspopup="dialog"
                  className="mt-3 flex min-h-11 items-center justify-center rounded-full px-4 text-[13px] font-semibold text-vs-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-primary"
                >
                  {related.total > 0 ? `Related passages (${related.total})` : "Related passages"}
                </button>
              ) : null}
            </article>
          ) : networkProblem ? (
            <StateMessage
              illustration={<ErrorIllustration />}
              title="Connection problem"
              titleClassName={ERROR_TITLE_CLASS}
              action={
                <>
                  <button
                    type="button"
                    className={PILL_OUTLINE}
                    onClick={() => verseQuery.refetch()}
                  >
                    Try again
                  </button>
                  <OfflineSwitch
                    current={params.translation}
                    onSwitch={(code) =>
                      navigate({
                        to: "/verse/$translation/$book/$chapter/$verse",
                        params: { ...params, translation: code },
                      })
                    }
                  />
                </>
              }
            >
              {errorMessage}
            </StateMessage>
          ) : (
            <StateMessage
              illustration={<NoResultsIllustration />}
              title="Verse not found"
              action={
                <NotFoundActions
                  onRetry={verseQuery.isError ? () => verseQuery.refetch() : undefined}
                />
              }
            >
              {providerError?.kind === "translation" ? errorMessage : NOT_FOUND_MESSAGE}
            </StateMessage>
          )}
        </main>

        {verse ? (
          <footer className="-mx-1 flex items-stretch justify-between gap-3 pb-3">
            {neighbourCard("previous", neighbours?.previous)}
            {neighbourCard("next", neighbours?.next)}
          </footer>
        ) : null}
      </AppShell>

      <CrossReferenceSheet
        open={relatedOpen}
        onOpenChange={setRelatedOpen}
        anchor={{
          bookId: params.book,
          chapter: Number(params.chapter),
          verse: Number(params.verse),
          label: `${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse}`,
        }}
        translation={params.translation}
        passages={related.items}
        total={related.total}
        loading={xrefs.isLoading}
        failed={xrefs.isError}
        onRetry={() => void xrefs.refetch()}
      />
      {verse ? (
        <ShareSheet
          open={shareOpen}
          onOpenChange={setShareOpen}
          verse={verse}
          notify={(text) => toast(text)}
        />
      ) : null}

      <TranslationSheet
        open={translationsOpen}
        onOpenChange={setTranslationsOpen}
        returnFocusRef={translationButtonRef}
        current={shownTranslation}
        options={translations ?? BIBLE_TRANSLATIONS}
        onConfirm={(code) => {
          setTranslationsOpen(false);
          if (code === params.translation) return;
          navigate({
            to: "/verse/$translation/$book/$chapter/$verse",
            params: { ...params, translation: code },
          });
        }}
      />
    </>
  );
}
