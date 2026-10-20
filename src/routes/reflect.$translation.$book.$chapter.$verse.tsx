import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BottomNav } from "@/components/bottom-nav";
import { ChapterToast } from "@/components/chapter-reader-parts";
import {
  ADD_TAG_CLASS,
  AddTagLabel,
  CARD,
  ChoiceSheet,
  CONTEXT_LINK_CLASS,
  ContextLinkLabel,
  EditorStatus,
  FormatToolbar,
  JournalHeader,
  MORE_BUTTON_CLASS,
  OrganizationCard,
  PostureRow,
  ReferenceCard,
  TagsSection,
} from "@/components/reflection-parts";
import {
  ERROR_TITLE_CLASS,
  ErrorIllustration,
  LoadingState,
  PILL_OUTLINE,
  StateMessage,
} from "@/components/search-states";
import { MoreHorizIcon } from "@/components/stitch-icons";
import { TONES, toneInfo, type Tone } from "@/components/verse-annotation-parts";
import { findBook } from "@/lib/bible/books";
import {
  getReflectionSuggestions,
  SAMPLE_NOTEBOOKS,
  SPIRITUAL_POSTURES,
} from "@/lib/bible/reflection-sample";
import { BibleServiceError } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { copyText } from "@/lib/copy-text";
import {
  applyFormat,
  countWords,
  normaliseTag,
  scriptureCitation,
  wordCountLabel,
  type FormatKind,
} from "@/lib/reflection-format";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { useDictation } from "@/lib/use-dictation";

type ReflectSearch = { tone?: Exclude<Tone, "clear"> };

export const Route = createFileRoute("/reflect/$translation/$book/$chapter/$verse")({
  validateSearch: (search: Record<string, unknown>): ReflectSearch => {
    const tone = search["tone"];
    return TONES.some((item) => item.id === tone && item.id !== "clear")
      ? { tone: tone as Exclude<Tone, "clear"> }
      : {};
  },
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse}`;
    return {
      meta: [
        { title: `Reflect on ${reference} — Verse Snap` },
        { name: "description", content: `Write a reflection on ${reference}.` },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: ReflectionPage,
});

const TOAST_MS = 2600;
const IDLE_MS = 1200;
// Honest status copy: nothing is stored until the journal has a backend.
const STATUS_PREVIEW = "Preview · notes aren’t saved yet";
const STATUS_EDITING = "Editing…";
const STATUS_DRAFT = "Draft on this screen · not saved";
const MENU_ITEM =
  "flex w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors data-[highlighted]:bg-ch-container";

function ReflectionPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const goBack = useBackOrHome();
  const book = findBook(params.book);
  const chapter = Number(params.chapter);
  const verseNumber = Number(params.verse);
  const valid =
    Boolean(book) &&
    Number.isInteger(chapter) &&
    chapter > 0 &&
    Number.isInteger(verseNumber) &&
    verseNumber > 0;
  const ref = useMemo(
    () => ({
      bookId: params.book,
      bookName: book?.name ?? params.book,
      chapter,
      verse: verseNumber,
    }),
    [params.book, book?.name, chapter, verseNumber],
  );
  // Same key as the single-verse page, so a verse already fetched there is reused.
  const verseQuery = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(ref, params.translation),
    enabled: valid,
    retry: 1,
  });
  const verse = verseQuery.data;
  const suggestions = getReflectionSuggestions(params.book, chapter, verseNumber);

  // --- draft (kept in memory on this screen only) -------------------------------------------------
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState(STATUS_PREVIEW);
  const [editing, setEditing] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  const [customTags, setCustomTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const addTagButtonRef = useRef<HTMLButtonElement | null>(null);

  const [posture, setPosture] = useState<string | null>(null);
  const [postureOpen, setPostureOpen] = useState(false);
  const postureButtonRef = useRef<HTMLButtonElement | null>(null);
  const [notebook, setNotebook] = useState(suggestions.notebookId);
  const [notebooksOpen, setNotebooksOpen] = useState(false);
  const notebookButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isPrivate, setIsPrivate] = useState(true);

  const [toast, setToast] = useState<{ message: string; action?: ReactNode } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((message: string, action?: ReactNode) => {
    setToast(action ? { message, action } : { message });
    setToastVisible(true);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    },
    [],
  );

  const hasDraft = body.trim().length > 0 || subtitle.trim().length > 0;

  /** Marks the draft as being edited, then settles on the honest "not saved" status. */
  const touch = useCallback(() => {
    setEditing(true);
    setStatus(STATUS_EDITING);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setEditing(false);
      setStatus(STATUS_DRAFT);
    }, IDLE_MS);
  }, []);

  // Grow the note with its content, and restore the selection after a toolbar change.
  useLayoutEffect(() => {
    const area = bodyRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.max(160, area.scrollHeight)}px`;
    const selection = pendingSelection.current;
    if (selection) {
      pendingSelection.current = null;
      area.focus();
      area.setSelectionRange(selection.start, selection.end);
    }
  }, [body]);

  const citation = verse ? scriptureCitation(verse.text, verse.reference, verse.translation) : "";

  const format = (kind: FormatKind) => {
    const area = bodyRef.current;
    if (!area) return;
    if (kind === "quote" && !citation) {
      showToast("The verse is still loading");
      return;
    }
    const next = applyFormat(
      { text: body, start: area.selectionStart, end: area.selectionEnd },
      kind,
      citation,
    );
    pendingSelection.current = { start: next.start, end: next.end };
    setBody(next.text);
    touch();
  };

  // --- voice dictation (browser speech recognition, when available) ------------------------------
  const insertDictation = useCallback(
    (spoken: string) => {
      const area = bodyRef.current;
      setBody((current) => {
        const at = area ? area.selectionEnd : current.length;
        const before = current.slice(0, at);
        const after = current.slice(at);
        const lead = before && !/\s$/.test(before) ? " " : "";
        const sentence = spoken.charAt(0).toUpperCase() + spoken.slice(1);
        const inserted = `${lead}${sentence}.`;
        pendingSelection.current = { start: at + inserted.length, end: at + inserted.length };
        return before + inserted + after;
      });
      touch();
    },
    [touch],
  );
  const dictation = useDictation(insertDictation);
  useEffect(() => {
    if (dictation.state === "unsupported") {
      showToast("Voice dictation isn’t supported in this browser — try your keyboard’s mic");
    } else if (dictation.state === "error") {
      showToast("Couldn’t hear that — check microphone access and try again");
    }
  }, [dictation.state, showToast]);

  // --- tags --------------------------------------------------------------------------------------
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    return [...suggestions.tags, ...customTags].filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [suggestions.tags, customTags]);

  const toggleTag = (tag: string) =>
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const commitTag = () => {
    const tag = normaliseTag(tagInput);
    setTagInput("");
    setAddingTag(false);
    window.requestAnimationFrame(() => addTagButtonRef.current?.focus());
    if (!tag) return;
    const existing = allTags.find((item) => item.toLowerCase() === tag.toLowerCase());
    if (!existing) setCustomTags((current) => [...current, tag]);
    setSelectedTags((current) => new Set(current).add(existing ?? tag));
  };

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // --- actions -----------------------------------------------------------------------------------
  const noteAsText = () => {
    const lines = [verse ? citation : `${ref.bookName} ${chapter}:${verseNumber}`, ""];
    if (subtitle.trim()) lines.push(subtitle.trim(), "");
    if (body.trim()) lines.push(body.trim());
    if (selectedTags.size) lines.push("", [...selectedTags].join(" "));
    return lines.join("\n").trim();
  };

  const copyNote = async () => {
    try {
      await copyText(noteAsText());
      showToast("Note copied to the clipboard");
    } catch {
      showToast("Could not copy the note");
    }
  };

  const saveNote = () => {
    if (!hasDraft) {
      showToast("Write a reflection first");
      bodyRef.current?.focus();
      return;
    }
    showToast(
      "Not saved — the journal isn’t connected yet",
      <button
        type="button"
        onClick={() => void copyNote()}
        className="rounded-full px-2 py-0.5 font-semibold text-ch-primary-fixed underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary-fixed"
      >
        Copy note
      </button>,
    );
  };

  const clearDraft = () => {
    setSubtitle("");
    setBody("");
    setSelectedTags(new Set());
    setCustomTags([]);
    setPosture(null);
    setEditing(false);
    setStatus(STATUS_PREVIEW);
    showToast("Draft cleared");
  };

  const leave = () => {
    if (
      hasDraft &&
      !window.confirm(
        "Leave this reflection? It hasn’t been saved — the journal isn’t connected yet.",
      )
    ) {
      return;
    }
    goBack();
  };

  const toneDetails = search.tone ? toneInfo(search.tone) : null;
  const postureLabel = SPIRITUAL_POSTURES.find((item) => item.id === posture)?.label ?? null;
  const notebookName =
    SAMPLE_NOTEBOOKS.find((item) => item.id === notebook)?.name ?? SAMPLE_NOTEBOOKS[0]!.name;
  const networkProblem =
    verseQuery.error instanceof BibleServiceError && verseQuery.error.kind === "network";

  return (
    <div className="flex min-h-dvh flex-col bg-ch-surface font-stitch text-ch-on-surface">
      <JournalHeader
        onBack={leave}
        menu={
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
                className="z-[70] min-w-52 rounded-2xl border border-ch-container-high bg-ch-container-lowest p-1.5 font-stitch text-ch-on-surface shadow-xl"
              >
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void copyNote()}>
                  Copy note
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild className={MENU_ITEM}>
                  <Link to="/verse/$translation/$book/$chapter/$verse" params={params}>
                    Open in the verse reader
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-ch-container-high" />
                <DropdownMenu.Item
                  className={`${MENU_ITEM} text-ch-error`}
                  disabled={!hasDraft}
                  onSelect={clearDraft}
                >
                  Clear draft
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        }
      />

      <main className="relative flex w-full flex-1 flex-col pt-[calc(4rem+env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-2">
          {!valid ? (
            <StateMessage
              illustration={<ErrorIllustration />}
              title="Verse not found"
              titleClassName={ERROR_TITLE_CLASS}
            >
              That Bible reference doesn&apos;t look right.
            </StateMessage>
          ) : (
            <ReferenceCard
              referenceLabel={`${ref.bookName} ${chapter}:${verseNumber} (${params.translation})`}
              highlight={toneDetails ? { name: toneDetails.name, dot: toneDetails.dot } : null}
              verseText={
                verseQuery.isLoading ? (
                  <span className="not-italic">
                    <LoadingState />
                  </span>
                ) : verse ? (
                  `“${verse.text}”`
                ) : (
                  <span className="block font-stitch text-sm not-italic leading-5 text-ch-on-surface-variant">
                    {networkProblem
                      ? "Couldn’t load the verse text. Check your connection — you can still write."
                      : "This verse isn’t in this edition."}
                    {verseQuery.isError ? (
                      <button
                        type="button"
                        className={`${PILL_OUTLINE} mt-3`}
                        onClick={() => verseQuery.refetch()}
                      >
                        Try again
                      </button>
                    ) : null}
                  </span>
                )
              }
              theme={
                suggestions.theme ? (
                  <>
                    Theme: {suggestions.theme} <span className="text-ch-outline">(sample)</span>
                  </>
                ) : (
                  "Theme suggestions aren’t available yet"
                )
              }
              contextLink={
                <Link
                  to="/chapter/$translation/$book/$chapter"
                  params={{
                    translation: params.translation,
                    book: params.book,
                    chapter: params.chapter,
                  }}
                  className={CONTEXT_LINK_CLASS}
                >
                  <ContextLinkLabel />
                </Link>
              }
            />
          )}

          <section aria-label="Reflection" className={`${CARD} relative flex flex-col gap-4 p-6`}>
            <EditorStatus
              status={status}
              editing={editing}
              words={wordCountLabel(countWords(body))}
            />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="reflection-subtitle"
                className="font-display text-xl font-medium leading-7 text-ch-on-surface"
              >
                What is God speaking to you today?
              </label>
              <input
                id="reflection-subtitle"
                type="text"
                value={subtitle}
                maxLength={120}
                onChange={(event) => {
                  setSubtitle(event.target.value);
                  touch();
                }}
                placeholder="Add a subtitle or key impression..."
                className="bg-transparent text-sm leading-5 text-ch-on-surface-variant placeholder:text-ch-outline/60 focus:outline-none"
              />
            </div>
            <div className="relative flex min-h-[160px] flex-col">
              <textarea
                ref={bodyRef}
                aria-label="Reflection"
                value={body}
                rows={5}
                onChange={(event) => {
                  setBody(event.target.value);
                  touch();
                }}
                placeholder="Pour out your heart, observations, prayer requests, or personal action steps..."
                className="min-h-[160px] w-full resize-none overflow-hidden bg-transparent text-base leading-relaxed text-ch-on-surface placeholder:text-ch-outline/60 selection:bg-ch-primary-fixed focus:outline-none"
              />
            </div>
            <PostureRow
              label={postureLabel}
              onChange={() => setPostureOpen(true)}
              buttonRef={postureButtonRef}
            />
          </section>

          <TagsSection
            tags={allTags}
            selected={selectedTags}
            onToggle={toggleTag}
            addControl={
              addingTag ? (
                <input
                  ref={tagInputRef}
                  value={tagInput}
                  aria-label="New tag"
                  placeholder="#NewTag"
                  maxLength={30}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitTag();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setTagInput("");
                      setAddingTag(false);
                      window.requestAnimationFrame(() => addTagButtonRef.current?.focus());
                    }
                  }}
                  onBlur={commitTag}
                  className="w-32 rounded-full bg-ch-container px-3 py-1.5 text-[13px] font-medium leading-[18px] text-ch-on-surface placeholder:text-ch-outline/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary"
                />
              ) : (
                <button
                  ref={addTagButtonRef}
                  type="button"
                  onClick={() => setAddingTag(true)}
                  className={ADD_TAG_CLASS}
                >
                  <AddTagLabel />
                </button>
              )
            }
          />

          <OrganizationCard
            notebookName={notebookName}
            notebookNote="Preview · not connected yet"
            onOpenNotebooks={() => setNotebooksOpen(true)}
            notebookButtonRef={notebookButtonRef}
            isPrivate={isPrivate}
            onTogglePrivate={() => setIsPrivate((current) => !current)}
          />

          <aside className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 w-full">
            <FormatToolbar
              onFormat={format}
              dictating={dictation.state === "listening"}
              onDictate={dictation.toggle}
              onSave={saveNote}
            />
          </aside>
        </div>
      </main>

      <BottomNav />
      <ChapterToast
        message={toast?.message ?? ""}
        visible={toastVisible}
        positionClass="bottom-[calc(9rem+env(safe-area-inset-bottom))]"
        {...(toast?.action ? { action: toast.action } : {})}
      />

      <ChoiceSheet
        open={postureOpen}
        onOpenChange={setPostureOpen}
        title="Spiritual posture"
        description="How are you coming to this verse?"
        name="spiritual_posture"
        options={SPIRITUAL_POSTURES}
        value={posture}
        onChange={(id) => {
          setPosture(id);
          setPostureOpen(false);
          touch();
        }}
        returnFocusRef={postureButtonRef}
      />
      <ChoiceSheet
        open={notebooksOpen}
        onOpenChange={setNotebooksOpen}
        title="Notebook"
        description="Preview — notebooks aren’t connected yet"
        name="notebook"
        options={SAMPLE_NOTEBOOKS.map((item) => ({ id: item.id, label: item.name }))}
        value={notebook}
        onChange={(id) => {
          setNotebook(id);
          setNotebooksOpen(false);
        }}
        returnFocusRef={notebookButtonRef}
      />
    </div>
  );
}
