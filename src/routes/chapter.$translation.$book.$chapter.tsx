import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CHAPTER_DROP_CAP_CLASS,
  ChapterControls,
  ChapterHeading,
  ChapterToast,
  FLOATING_NAV_BUTTON,
  FloatingChapterNav,
  FloatingNavLabel,
  VERSE_NUMBER_CLASS,
  VerseBlock,
} from "@/components/chapter-reader-parts";
import { BottomNav } from "@/components/bottom-nav";
import {
  MultiSelectBar,
  NoteIconButton,
  ReflectionNoteDialog,
} from "@/components/reader-multi-parts";
import { TextSizeSheet } from "@/components/chapter-sheets";
import { CompareSheet } from "@/components/compare-sheet";
import {
  ERROR_TITLE_CLASS,
  ErrorIllustration,
  LoadingState,
  PILL_OUTLINE,
  StateMessage,
} from "@/components/search-states";
import { BookmarkIcon, EditNoteIcon, PaletteIcon, TuneIcon } from "@/components/stitch-icons";
import { OfflineSwitch } from "@/components/offline-switch";
import { ShareSheet } from "@/components/share-sheet";
import { TranslationSheet } from "@/components/translation-sheet";
import {
  ActionTile,
  AnnotationSheet,
  CROSS_REF_CHIP_CLASS,
  CrossRefChipContent,
  CrossReferenceSection,
  HighlightPicker,
  QuickActions,
  SelectionToolbar,
  SpokenCard,
  toneInfo,
  type Tone,
} from "@/components/verse-annotation-parts";
import { setLastRead } from "@/lib/last-read";
import { BIBLE_BOOKS, findBook } from "@/lib/bible/books";
import { shortBookName } from "@/lib/bible/book-labels";
import { BibleServiceError, type Verse } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { BIBLE_TRANSLATIONS, translationName } from "@/lib/bible/translations";
import { toChips } from "@/lib/bible/cross-references";
import { useVerseCrossRefs } from "@/lib/bible/use-cross-references";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/copy-text";
import { highlights } from "@/lib/highlights";
import { journal } from "@/lib/journal";
import { reflectionsByVerse, toggleVerse } from "@/lib/verse-selection";
import { library } from "@/lib/library";
import { usePreferences } from "@/lib/preferences";
import { verseShareText } from "@/lib/share-verse-card";
import { useSpeak } from "@/lib/use-speak";

export const Route = createFileRoute("/chapter/$translation/$book/$chapter")({
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}`;
    return {
      meta: [
        { title: `${reference} (${params.translation}) — Verse Snap` },
        { name: "description", content: `Read ${reference} on Verse Snap.` },
        { property: "og:title", content: `${reference} — Verse Snap` },
        { property: "og:description", content: `Read the full chapter of ${reference}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: ChapterPage,
});

const TOAST_MS = 2200;
/** How long a chapter must stay open before it is recorded in History. */
const CHAPTER_VISIT_DELAY_MS = 4000;

function ChapterPage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { textSize, setTextSize } = usePreferences();
  const book = findBook(params.book);
  const chapterNumber = Number(params.chapter);
  const ref = { bookId: params.book, bookName: book?.name ?? params.book, chapter: chapterNumber };
  const query = useQuery({
    queryKey: ["chapter", params.translation, params.book, params.chapter],
    queryFn: () => bibleService.getChapter(ref, params.translation),
    enabled: Boolean(book && Number.isInteger(chapterNumber) && chapterNumber > 0),
  });
  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });

  useEffect(() => {
    if (query.data) {
      setLastRead({ translation: params.translation, bookId: params.book, chapter: chapterNumber });
    }
  }, [query.data, params.translation, params.book, chapterNumber]);

  // History: a chapter counts as read after a few seconds on it, so flicking through chapters or
  // re-renders don't add entries. One entry per chapter and translation (moved to the top).
  const chapterLoaded = Boolean(query.data);
  useEffect(() => {
    if (!chapterLoaded || authLoading || !book) return;
    const timer = window.setTimeout(() => {
      void library
        .recordChapterVisit(
          {
            translation: params.translation,
            bookId: params.book,
            bookName: book.name,
            chapter: chapterNumber,
          },
          user?.id,
        )
        .then((recorded) => {
          if (recorded) void queryClient.invalidateQueries({ queryKey: ["history"] });
        })
        .catch(() => undefined);
    }, CHAPTER_VISIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    chapterLoaded,
    authLoading,
    book,
    params.translation,
    params.book,
    chapterNumber,
    user?.id,
    queryClient,
  ]);

  // Chapter-level neighbours, crossing book boundaries at the edges.
  const bookIndex = BIBLE_BOOKS.findIndex((item) => item.id === book?.id);
  const previousBook = bookIndex > 0 ? BIBLE_BOOKS[bookIndex - 1] : undefined;
  const nextBook = bookIndex >= 0 ? BIBLE_BOOKS[bookIndex + 1] : undefined;
  const previous =
    book && chapterNumber > 1
      ? {
          bookId: book.id,
          chapter: chapterNumber - 1,
          label: `${shortBookName(book)} ${chapterNumber - 1}`,
          full: `${book.name} ${chapterNumber - 1}`,
        }
      : previousBook
        ? {
            bookId: previousBook.id,
            chapter: previousBook.chapters,
            label: `${shortBookName(previousBook)} ${previousBook.chapters}`,
            full: `${previousBook.name} ${previousBook.chapters}`,
          }
        : null;
  const next =
    book && chapterNumber < book.chapters
      ? {
          bookId: book.id,
          chapter: chapterNumber + 1,
          label: `${shortBookName(book)} ${chapterNumber + 1}`,
          full: `${book.name} ${chapterNumber + 1}`,
        }
      : nextBook
        ? {
            bookId: nextBook.id,
            chapter: 1,
            label: `${shortBookName(nextBook)} 1`,
            full: `${nextBook.name} 1`,
          }
        : null;

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const networkProblem = query.error instanceof BibleServiceError && query.error.kind === "network";
  const message = networkProblem
    ? offline
      ? "You’re offline, and this chapter isn’t saved on this device yet. Chapters you’ve opened recently are available offline — reconnect to read this one."
      : "Verse Snap couldn’t reach the Bible. Check your connection and try again."
    : "That Bible reference doesn't look right.";

  // --- interface state (kept in memory; highlights are saved separately, see pickTone) ---------
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [textSizeOpen, setTextSizeOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const translationButtonRef = useRef<HTMLButtonElement | null>(null);
  const textSizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  // Escape that just closed the compare sheet must not also close the annotation sheet.
  const overlayClosedAt = useRef(0);

  const [progress, setProgress] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  // The annotation sheet opens small; swiping up shows every option.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // A single tap only marks a verse; the options open on the second tap.
  const [markedVerse, setMarkedVerse] = useState<number | null>(null);
  // Several verses chosen to highlight together (null = not choosing).
  const [multi, setMulti] = useState<number[] | null>(null);
  // The verse whose saved reflection is open in the note dialog.
  const [noteVerse, setNoteVerse] = useState<number | null>(null);
  // Highlight colours chosen in this visit, per verse ("clear" = removed). They are saved as they
  // are chosen (see pickTone) and take precedence over the stored highlights loaded below.
  const [tones, setTones] = useState<Record<number, Tone>>({});
  // Highlight writes run one after another, so the last colour chosen is the one kept.
  const highlightWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [toast, setToast] = useState<{ message: string; action?: ReactNode } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string, action?: ReactNode) => {
    setToast(action ? { message: text, action } : { message: text });
    setToastVisible(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const speech = useSpeak(showToast);
  const stopSpeech = speech.stop;

  // Another chapter starts with a clean slate.
  useEffect(() => {
    setBookmarked(false);
    setSelectedVerse(null);
    setTones({});
    setMarkedVerse(null);
    setMulti(null);
    setNoteVerse(null);
    setSheetExpanded(false);
    setCompareOpen(false);
    setShareOpen(false);
    setToastVisible(false);
    setProgress(0);
    stopSpeech();
    window.scrollTo?.(0, 0);
  }, [params.book, params.chapter, params.translation, stopSpeech]);

  // Signing in or out shows that person's highlights only.
  useEffect(() => {
    setTones({});
    setMulti(null);
    setNoteVerse(null);
  }, [user?.id]);

  // Stored highlights for this chapter, translation and person (refetched on return to the tab,
  // so changes made on another device appear).
  const { data: storedHighlights } = useQuery({
    queryKey: ["highlights", user?.id ?? "guest", params.translation, params.book, chapterNumber],
    queryFn: () => highlights.forChapter(params.translation, params.book, chapterNumber, user?.id),
    enabled: !authLoading,
  });
  const toneOf = (verse: number): Tone | undefined => tones[verse] ?? storedHighlights?.[verse];

  /** Shows the colour at once and saves it; resolves false (after undoing it) if saving failed. */
  const saveTone = (verse: number, tone: Tone): Promise<boolean> => {
    const previous = tones[verse];
    setTones((current) => ({ ...current, [verse]: tone }));
    if (!highlights.persists(user?.id)) return Promise.resolve(true);
    const ref = {
      translation: params.translation,
      bookId: params.book,
      chapter: chapterNumber,
      verse,
    };
    const userId = user?.id;
    const write = highlightWrites.current
      .then(() =>
        tone === "clear" ? highlights.remove(ref, userId) : highlights.set(ref, tone, userId),
      )
      .then(() => queryClient.invalidateQueries({ queryKey: ["highlights"] }))
      .then(() => true)
      .catch(() => {
        setTones((current) => {
          const next = { ...current };
          if (previous === undefined) delete next[verse];
          else next[verse] = previous;
          return next;
        });
        return false;
      });
    highlightWrites.current = write;
    return write;
  };

  const pickTone = (verse: number, tone: Tone) => {
    void saveTone(verse, tone).then((saved) => {
      if (!saved) showToast("Couldn’t save the highlight. Try again.");
    });
  };

  // --- choosing several verses ------------------------------------------------------------------
  const startMulti = useCallback((verse: number) => {
    setSelectedVerse(null);
    setMarkedVerse(null);
    setSheetExpanded(false);
    setMulti((current) => (current === null ? [verse] : current));
  }, []);

  const toggleMulti = (verse: number) => {
    setMulti((current) => {
      if (current === null) return current;
      const next = toggleVerse(current, verse);
      return next.length === 0 ? null : next;
    });
  };

  // Every chosen verse gets the colour; ones that fail are undone and counted, the rest stay.
  const pickMultiTone = (tone: Tone) => {
    const chosen = multi ?? [];
    void Promise.all(chosen.map((verse) => saveTone(verse, tone))).then((results) => {
      const failed = results.filter((saved) => !saved).length;
      if (failed > 0) {
        showToast(`Couldn’t save ${failed} of ${chosen.length} highlights. The others were saved.`);
      }
    });
  };

  // Escape ends choosing.
  const choosing = multi !== null;
  useEffect(() => {
    if (!choosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMulti(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choosing]);

  // --- saved reflections (the same query as Saved and the editor) -------------------------------
  const journalOn = journal.persists(user?.id);
  const { data: allReflections } = useQuery({
    queryKey: ["reflections", user?.id ?? "guest"],
    queryFn: () => journal.listReflections(user?.id),
    enabled: !authLoading && journalOn,
  });
  const chapterReflections = reflectionsByVerse(
    allReflections ?? [],
    params.translation,
    params.book,
    chapterNumber,
  );
  const noteReflection = noteVerse !== null ? (chapterReflections.get(noteVerse) ?? null) : null;
  const { data: notebooks } = useQuery({
    queryKey: ["notebooks", user?.id ?? "guest"],
    queryFn: () => journal.listNotebooks(user?.id),
    enabled: !authLoading && journalOn && noteVerse !== null,
  });
  const noteNotebook = notebooks?.find((item) => item.id === noteReflection?.notebookId)?.name;

  // Reading progress follows the scroll position.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(
        max > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100))) : 0,
      );
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [query.data]);

  const verses = query.data?.verses ?? [];
  const chapterLabel = `${ref.bookName} ${chapterNumber}`;
  const selected: Verse | undefined = verses.find((item) => item.verse === selectedVerse);
  const editionOptions = translations ?? BIBLE_TRANSLATIONS;
  const otherEditions = editionOptions.filter((item) => item.code !== params.translation);

  // --- Save (the same library the single-verse page uses) -----------------------------------------
  const verseRef = selected
    ? { bookId: params.book, bookName: ref.bookName, chapter: chapterNumber, verse: selected.verse }
    : null;
  const { data: saved } = useQuery({
    queryKey: [
      "saved",
      "is",
      user?.id,
      params.translation,
      params.book,
      params.chapter,
      String(selected?.verse),
    ],
    queryFn: () => library.isSaved(verseRef!, params.translation, user?.id),
    enabled: Boolean(verseRef) && !authLoading,
  });
  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!selected || !verseRef) return;
      if (saved) await library.unsave(verseRef, params.translation, user?.id);
      else await library.save(selected, user?.id);
    },
    onSuccess: () => {
      if (!saved) trackEvent("verse_saved");
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      showToast(saved ? "Removed from saved" : "Saved");
    },
    onError: () => showToast("Could not update saved verses"),
  });

  // --- selection: open, close, keep in view, keyboard ---------------------------------------------
  const selectVerse = (number: number) => {
    setSheetExpanded(false);
    setSelectedVerse(number);
  };

  // First tap marks the verse; tapping the marked verse again (a double tap) opens the options.
  const tapVerse = (number: number) => {
    if (markedVerse === number) {
      selectVerse(number);
      return;
    }
    setMarkedVerse(number);
    showToast("Double-tap for more options");
  };

  const closeAnnotation = useCallback(() => {
    const number = selectedVerse;
    setSelectedVerse(null);
    setSheetExpanded(false);
    setCompareOpen(false);
    setShareOpen(false);
    stopSpeech();
    // Put keyboard focus back on the verse that was open.
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-verse-block="${number}"]`)?.focus();
    });
  }, [selectedVerse, stopSpeech]);

  // When a verse opens: move focus into the sheet and scroll the verse clear of the sheet and header.
  useEffect(() => {
    if (selectedVerse === null) return;
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.focus();
      const element = document.querySelector<HTMLElement>(
        '[data-verse-block][data-selected="true"]',
      );
      const sheet = sheetRef.current;
      if (!element || !sheet) return;
      const topLimit = 56 + 3 + 56; // controls, progress bar and the floating toolbar
      const bottomLimit = window.innerHeight - sheet.getBoundingClientRect().height - 12;
      const rect = element.getBoundingClientRect();
      if (rect.top < topLimit) window.scrollBy({ top: rect.top - topLimit });
      else if (rect.bottom > bottomLimit) {
        window.scrollBy({ top: Math.min(rect.bottom - bottomLimit, rect.top - topLimit) });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedVerse]);

  // Escape closes the sheet; Tab stays inside the toolbar and the sheet while it is open.
  const overlayOpen = translationsOpen || textSizeOpen || compareOpen || shareOpen;
  useEffect(() => {
    if (selectedVerse === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (overlayOpen || Date.now() - overlayClosedAt.current < 150) return;
      if (event.key === "Escape") {
        event.preventDefault();
        // An expanded sheet steps back to the small one first.
        if (sheetExpanded) setSheetExpanded(false);
        else closeAnnotation();
        return;
      }
      if (event.key !== "Tab") return;
      const scope = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-verse-block][data-selected="true"] [role="toolbar"] button',
        ),
        ...(sheetRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (scope.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const at = active ? scope.indexOf(active) : -1;
      // Move through the toolbar and then the sheet ourselves, wrapping at both ends.
      const step = event.shiftKey ? -1 : 1;
      const target =
        at === -1
          ? scope[event.shiftKey ? scope.length - 1 : 0]
          : scope[(at + step + scope.length) % scope.length];
      event.preventDefault();
      target?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedVerse, overlayOpen, closeAnnotation, sheetExpanded]);

  const handleCopy = async () => {
    if (!selected) return;
    try {
      await copyText(verseShareText(selected));
      trackEvent("verse_copied");
      showToast("Copied");
    } catch {
      showToast("Could not copy this verse");
    }
  };

  const chosenTone = selectedVerse !== null ? toneOf(selectedVerse) : undefined;
  // The colour every verse chosen together already has (null when they differ or have none).
  const commonTone: Tone | null = (() => {
    const first = multi?.length ? toneOf(multi[0]!) : undefined;
    return first && first !== "clear" && multi!.every((verse) => toneOf(verse) === first)
      ? first
      : null;
  })();
  const activeTone: Tone = chosenTone ?? "amber";
  // Real cross-references for the verse that is open (one small file per chapter, cached).
  const xrefs = useVerseCrossRefs(
    params.book,
    chapterNumber,
    selected?.verse ?? 0,
    Boolean(selected),
  );

  const floatingLink = (
    target: { bookId: string; chapter: number; label: string; full: string } | null,
    direction: "previous" | "next",
  ): ReactNode => {
    if (!target) {
      return (
        <span
          aria-disabled="true"
          className={`${FLOATING_NAV_BUTTON} pointer-events-none opacity-40`}
        >
          <FloatingNavLabel direction={direction} label="—" />
        </span>
      );
    }
    return (
      <Link
        to="/chapter/$translation/$book/$chapter"
        params={{
          translation: params.translation,
          book: target.bookId,
          chapter: String(target.chapter),
        }}
        aria-label={`${direction === "previous" ? "Previous" : "Next"} chapter: ${target.full}`}
        className={FLOATING_NAV_BUTTON}
      >
        <FloatingNavLabel direction={direction} label={target.label} />
      </Link>
    );
  };

  const speakText = selected ? `${selected.reference}. ${selected.text}` : "";

  return (
    <div className="flex min-h-dvh flex-col bg-ch-surface font-stitch text-ch-on-surface">
      <main className="relative flex w-full flex-1 flex-col">
        <div className="flex w-full flex-col pb-[calc(9rem+env(safe-area-inset-bottom))]">
          <ChapterControls
            chapterLabel={chapterLabel}
            translation={params.translation}
            onOpenChapters={() =>
              navigate({
                to: "/books",
                search: { translation: params.translation, book: params.book },
              })
            }
            onOpenTextSize={() => setTextSizeOpen(true)}
            bookmarked={bookmarked}
            onToggleBookmark={() => {
              const now = !bookmarked;
              setBookmarked(now);
              showToast(
                now
                  ? `${chapterLabel} bookmarked (preview only — not saved yet)`
                  : "Bookmark removed (preview only)",
              );
            }}
            progress={progress}
            textSizeButtonRef={textSizeButtonRef}
            onOpenTranslations={() => setTranslationsOpen(true)}
            translationButtonRef={translationButtonRef}
          />

          <div className="mx-auto flex w-full max-w-xl flex-col px-5 pt-6">
            {query.isLoading ? (
              <LoadingState />
            ) : query.data ? (
              <>
                <ChapterHeading chapter={chapterNumber} />

                <article
                  aria-label={`${chapterLabel} (${query.data.translation})`}
                  className="scripture-chapter flex select-text flex-col space-y-6 text-ch-on-surface"
                >
                  {verses.map((verse, index) => {
                    const isSelected = selectedVerse === verse.verse;
                    const verseTone = toneOf(verse.verse);
                    const savedTint =
                      verseTone && verseTone !== "clear" ? toneInfo(verseTone).tint : null;
                    return (
                      <div key={verse.verse} className="contents">
                        <VerseBlock
                          number={verse.verse}
                          text={verse.text}
                          selected={isSelected}
                          dimmed={selectedVerse !== null && !isSelected}
                          tint={isSelected ? toneInfo(activeTone).tint : savedTint}
                          dropCapNode={
                            index === 0 ? (
                              <Link
                                to="/verse/$translation/$book/$chapter/$verse"
                                params={{ ...params, verse: String(verse.verse) }}
                                aria-label={`Chapter ${chapterNumber}, verse ${verse.verse}. Open verse ${verse.verse}`}
                                onClick={(event) => event.stopPropagation()}
                                className={CHAPTER_DROP_CAP_CLASS}
                              >
                                {chapterNumber}
                              </Link>
                            ) : undefined
                          }
                          marked={!isSelected && markedVerse === verse.verse}
                          onSelect={() =>
                            multi !== null ? toggleMulti(verse.verse) : tapVerse(verse.verse)
                          }
                          multi={{
                            active: multi !== null,
                            chosen: multi?.includes(verse.verse) ?? false,
                            onStart: () => startMulti(verse.verse),
                          }}
                          noteNode={
                            chapterReflections.has(verse.verse) ? (
                              <NoteIconButton
                                verse={verse.verse}
                                onOpen={() => setNoteVerse(verse.verse)}
                              />
                            ) : undefined
                          }
                          toolbar={
                            isSelected ? (
                              <SelectionToolbar
                                onCopy={() => void handleCopy()}
                                onCompare={() => setCompareOpen(true)}
                                onShare={() => setShareOpen(true)}
                              />
                            ) : null
                          }
                          numberNode={
                            <sup className="mr-1 text-xs font-semibold leading-none">
                              <Link
                                to="/verse/$translation/$book/$chapter/$verse"
                                params={{ ...params, verse: String(verse.verse) }}
                                aria-label={`Open verse ${verse.verse}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (multi !== null) {
                                    event.preventDefault();
                                    toggleMulti(verse.verse);
                                  }
                                }}
                                className={VERSE_NUMBER_CLASS}
                              >
                                {verse.verse}
                              </Link>
                            </sup>
                          }
                        />
                      </div>
                    );
                  })}
                </article>
              </>
            ) : networkProblem ? (
              <StateMessage
                illustration={<ErrorIllustration />}
                title="Connection problem"
                titleClassName={ERROR_TITLE_CLASS}
                action={
                  <>
                    <button type="button" className={PILL_OUTLINE} onClick={() => query.refetch()}>
                      Try again
                    </button>
                    <OfflineSwitch
                      current={params.translation}
                      onSwitch={(code) =>
                        navigate({
                          to: "/chapter/$translation/$book/$chapter",
                          params: { ...params, translation: code },
                        })
                      }
                    />
                  </>
                }
              >
                {message}
              </StateMessage>
            ) : (
              <StateMessage
                illustration={<ErrorIllustration />}
                title="Chapter not found"
                titleClassName={ERROR_TITLE_CLASS}
                action={
                  query.isError ? (
                    <button type="button" className={PILL_OUTLINE} onClick={() => query.refetch()}>
                      Try again
                    </button>
                  ) : null
                }
              >
                {message}
              </StateMessage>
            )}
          </div>
        </div>
      </main>

      {selected ? (
        <>
          <div
            className="fixed inset-0 z-30 bg-brand-scrim-soft backdrop-blur-[2px]"
            onClick={closeAnnotation}
            aria-hidden
          />
          <AnnotationSheet
            reference={selected.reference}
            referenceNode={
              <Link
                to="/verse/$translation/$book/$chapter/$verse"
                params={{ ...params, verse: String(selected.verse) }}
                aria-label={`${selected.reference}: open in the verse reader`}
                className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
              >
                {selected.reference}
              </Link>
            }
            editionLine={`${translationName(selected.translation)} (${selected.translation})`}
            speaking={speech.speaking}
            onToggleListen={() => speech.toggle(speakText)}
            onClose={closeAnnotation}
            expanded={sheetExpanded}
            onExpandedChange={setSheetExpanded}
            sheetRef={sheetRef}
            peek={
              <HighlightPicker
                active={activeTone}
                onChange={(tone) => pickTone(selected.verse, tone)}
              />
            }
            collapsedExtra={
              <QuickActions
                speaking={speech.speaking}
                onToggleListen={() => speech.toggle(speakText)}
                saved={Boolean(saved)}
                saveDisabled={toggleSave.isPending}
                onToggleSave={() => toggleSave.mutate()}
                onCopy={() => void handleCopy()}
                onCompare={() => setCompareOpen(true)}
              />
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <ActionTile
                icon={<BookmarkIcon className="h-[18px] w-[18px]" filled={Boolean(saved)} />}
                iconClass="text-ch-primary"
                badge={saved ? "Saved" : null}
                badgeClass="bg-brand-primary-soft text-ch-primary"
                title="Bookmark Verse"
                subtitle={saved ? "In your saved verses" : "Add to your saved verses"}
                pressed={Boolean(saved)}
                disabled={toggleSave.isPending}
                onClick={() => toggleSave.mutate()}
              />
              <ActionTile
                icon={<EditNoteIcon className="h-[18px] w-[18px]" />}
                iconClass="text-ch-secondary"
                chevron
                title="Add Reflection"
                subtitle="Attach personal note"
                onClick={() =>
                  navigate({
                    to: "/reflect/$translation/$book/$chapter/$verse",
                    params: { ...params, verse: String(selected.verse) },
                    search: chosenTone && chosenTone !== "clear" ? { tone: chosenTone } : {},
                  })
                }
              />
              <ActionTile
                icon={<PaletteIcon className="h-[18px] w-[18px]" />}
                iconClass="text-ch-tertiary"
                badge="Art"
                badgeClass="bg-brand-teal-soft text-ch-tertiary"
                title="Verse Card"
                subtitle="Design an image story"
                onClick={() =>
                  navigate({
                    to: "/card/$translation/$book/$chapter/$verse",
                    params: { ...params, verse: String(selected.verse) },
                  })
                }
              />
              <ActionTile
                icon={<TuneIcon className="h-[18px] w-[18px]" />}
                iconClass="text-ch-on-surface"
                chevron
                title={`Compare (${otherEditions.length})`}
                subtitle={`${otherEditions
                  .slice(0, 4)
                  .map((item) => item.code)
                  .join(", ")}${otherEditions.length > 4 ? "…" : ""}`}
                onClick={() =>
                  navigate({
                    to: "/compare/$translation/$book/$chapter/$verse",
                    params: { ...params, verse: String(selected.verse) },
                  })
                }
              />
            </div>
            <SpokenCard
              speaking={speech.speaking}
              onToggle={() => speech.toggle(speakText)}
              subtitle="Reads this verse aloud · browser voice"
            />
            <CrossReferenceSection
              total={xrefs.passages.length}
              chips={toChips(xrefs.passages)}
              status={
                xrefs.isLoading
                  ? "loading"
                  : xrefs.isError
                    ? "error"
                    : xrefs.passages.length === 0
                      ? "empty"
                      : "ready"
              }
              onRetry={() => void xrefs.refetch()}
              onExploreAll={() =>
                navigate({
                  to: "/references/$translation/$book/$chapter/$verse",
                  params: { ...params, verse: String(selected.verse) },
                })
              }
              chipNode={(chip, index) => (
                <Link
                  key={`${chip.label}-${index}`}
                  to="/verse/$translation/$book/$chapter/$verse"
                  params={{
                    translation: params.translation,
                    book: chip.target.book,
                    chapter: String(chip.target.chapter),
                    verse: String(chip.target.verse),
                  }}
                  className={CROSS_REF_CHIP_CLASS}
                >
                  <CrossRefChipContent chip={chip} />
                </Link>
              )}
            />
          </AnnotationSheet>
        </>
      ) : multi !== null ? (
        <MultiSelectBar
          count={multi.length}
          active={commonTone}
          onPick={pickMultiTone}
          onDone={() => setMulti(null)}
        />
      ) : (
        <FloatingChapterNav
          previous={floatingLink(previous, "previous")}
          next={floatingLink(next, "next")}
        />
      )}
      <BottomNav />
      <ChapterToast
        message={toast?.message ?? ""}
        visible={toastVisible}
        positionClass={selected ? "top-3" : "bottom-[calc(8rem+env(safe-area-inset-bottom))]"}
        {...(toast?.action ? { action: toast.action } : {})}
      />

      {selected ? (
        <ShareSheet
          open={shareOpen}
          onOpenChange={(open) => {
            if (!open) overlayClosedAt.current = Date.now();
            setShareOpen(open);
          }}
          verse={selected}
          notify={(text) => showToast(text)}
        />
      ) : null}

      {selected ? (
        <CompareSheet
          open={compareOpen}
          onOpenChange={(open) => {
            if (!open) overlayClosedAt.current = Date.now();
            setCompareOpen(open);
          }}
          reference={{
            bookId: params.book,
            bookName: ref.bookName,
            chapter: chapterNumber,
            verse: selected.verse,
          }}
          editions={editionOptions}
          currentCode={params.translation}
        />
      ) : null}

      <ReflectionNoteDialog
        open={noteVerse !== null}
        onOpenChange={(open) => {
          if (!open) setNoteVerse(null);
        }}
        reference={`${ref.bookName} ${chapterNumber}:${noteVerse ?? ""} (${params.translation})`}
        reflection={noteReflection}
        notebookName={noteNotebook}
        onEdit={() => {
          const verse = noteVerse;
          setNoteVerse(null);
          if (verse === null) return;
          navigate({
            to: "/reflect/$translation/$book/$chapter/$verse",
            params: { ...params, verse: String(verse) },
          });
        }}
      />
      <TranslationSheet
        open={translationsOpen}
        onOpenChange={setTranslationsOpen}
        current={query.data?.translation ?? params.translation}
        options={editionOptions}
        returnFocusRef={translationButtonRef}
        onConfirm={(code) => {
          setTranslationsOpen(false);
          if (code === params.translation) return;
          navigate({
            to: "/chapter/$translation/$book/$chapter",
            params: { ...params, translation: code },
          });
        }}
      />
      <TextSizeSheet
        open={textSizeOpen}
        onOpenChange={setTextSizeOpen}
        value={textSize}
        onChange={setTextSize}
        returnFocusRef={textSizeButtonRef}
      />
    </div>
  );
}
