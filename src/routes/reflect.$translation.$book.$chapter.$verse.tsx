import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  NotebookActions,
  OrganizationCard,
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
import { useAuth } from "@/lib/auth";
import { findBook } from "@/lib/bible/books";
import { getReflectionSuggestions } from "@/lib/bible/reflection-sample";
import { BibleServiceError } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { copyText } from "@/lib/copy-text";
import { highlights } from "@/lib/highlights";
import {
  DEFAULT_NOTEBOOK_NAME,
  journal,
  JournalError,
  type Reflection,
  type ReflectionDraft,
  type SavedBase,
} from "@/lib/journal";
import {
  applyFormat,
  normaliseTag,
  scriptureCitation,
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
// Signed in before the account journal is enabled (journal-schema.ts): an honest preview.
const STATUS_PREVIEW = "Preview · notes aren’t saved yet";
const STATUS_EDITING = "Editing…";
const STATUS_DRAFT = "Draft on this screen · not saved";
// Saved journals (guests on this device; accounts once enabled).
const STATUS_NEW = "New reflection · not saved yet";
const STATUS_UNSAVED = "Unsaved changes";
const STATUS_SAVING = "Saving…";
const STATUS_FAILED = "Couldn’t save · your text is still here";
const STATUS_CONFLICT = "Changed on another device · Save again to replace it";
const MENU_ITEM =
  "flex w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors data-[highlighted]:bg-ch-container";

/** "just now", "5 min ago", "today, 14:05" or "21 Oct". */
function savedLabel(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (then.toDateString() === new Date().toDateString()) return `today, ${time}`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The editable fields, as compared to decide whether there are unsaved changes. */
interface DraftState {
  notebook: string | null;
  title: string;
  body: string;
  tags: string[];
  posture: string | null;
  isPrivate: boolean;
}
const serialise = (state: DraftState) => JSON.stringify({ ...state, tags: [...state.tags].sort() });
const EMPTY_STATE: DraftState = {
  notebook: null,
  title: "",
  body: "",
  tags: [],
  posture: null,
  isPrivate: true,
};
const stateOf = (reflection: Reflection | null): DraftState =>
  reflection
    ? {
        notebook: reflection.notebookId,
        title: reflection.title,
        body: reflection.body,
        tags: reflection.tags,
        posture: reflection.posture,
        isPrivate: reflection.isPrivate,
      }
    : EMPTY_STATE;

function ReflectionPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const goBack = useBackOrHome();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id ?? "guest";
  const persisted = journal.persists(user?.id);
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
  const verseKey = useMemo(
    () => ({ translation: params.translation, bookId: params.book, chapter, verse: verseNumber }),
    [params.translation, params.book, chapter, verseNumber],
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

  // --- saved journal (this verse's reflection, the notebooks, the verse's highlight) --------------
  const reflectionKey = useCallback(
    (forOwner: string) => [
      "reflection",
      forOwner,
      params.translation,
      params.book,
      chapter,
      verseNumber,
    ],
    [params.translation, params.book, chapter, verseNumber],
  );
  const reflectionQuery = useQuery({
    queryKey: reflectionKey(owner),
    queryFn: () => journal.getReflection(verseKey, user?.id),
    enabled: valid && !authLoading && persisted,
  });
  const notebooksQuery = useQuery({
    queryKey: ["notebooks", owner],
    queryFn: () => journal.listNotebooks(user?.id),
    enabled: !authLoading && persisted,
  });
  const notebooks = useMemo(() => notebooksQuery.data ?? [], [notebooksQuery.data]);
  // Same key as the chapter reader, so the reader's highlights are reused.
  const highlightQuery = useQuery({
    queryKey: ["highlights", owner, params.translation, params.book, chapter],
    queryFn: () => highlights.forChapter(params.translation, params.book, chapter, user?.id),
    enabled: valid && !authLoading,
  });

  // --- draft ---------------------------------------------------------------------------------------
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
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
  const [notebook, setNotebook] = useState<string | null>(null);
  const [notebooksOpen, setNotebooksOpen] = useState(false);
  const notebookButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isPrivate, setIsPrivate] = useState(true);

  // The saved version being edited, the fields as saved, and the save outcome.
  const [base, setBase] = useState<SavedBase | null>(null);
  const [snapshot, setSnapshot] = useState(() => serialise(EMPTY_STATE));
  const [saveState, setSaveState] = useState<"idle" | "failed" | "conflict">("idle");

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

  /** Marks the draft as being edited for a moment (the status shows "Editing…"). */
  const touch = useCallback(() => {
    setEditing(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setEditing(false), IDLE_MS);
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

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
    touch();
  };

  const commitTag = () => {
    const tag = normaliseTag(tagInput);
    setTagInput("");
    setAddingTag(false);
    window.requestAnimationFrame(() => addTagButtonRef.current?.focus());
    if (!tag) return;
    const existing = allTags.find((item) => item.toLowerCase() === tag.toLowerCase());
    if (!existing) setCustomTags((current) => [...current, tag]);
    setSelectedTags((current) => new Set(current).add(existing ?? tag));
    touch();
  };

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // --- loading a saved reflection into the editor --------------------------------------------------
  const currentState: DraftState = {
    notebook,
    title: subtitle,
    body,
    tags: allTags.filter((tag) => selectedTags.has(tag)),
    posture,
    isPrivate,
  };
  const dirty = persisted && serialise(currentState) !== snapshot;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const applyReflection = useCallback(
    (reflection: Reflection | null) => {
      const state = stateOf(reflection);
      const suggested = new Set(suggestions.tags.map((tag) => tag.toLowerCase()));
      setSubtitle(state.title);
      setBody(state.body);
      setCustomTags(state.tags.filter((tag) => !suggested.has(tag.toLowerCase())));
      setSelectedTags(new Set(state.tags));
      setPosture(state.posture);
      setNotebook(state.notebook);
      setIsPrivate(state.isPrivate);
      setBase(reflection ? { id: reflection.id, updatedAt: reflection.updatedAt } : null);
      setSnapshot(serialise(state));
      setSaveState("idle");
    },
    [suggestions.tags],
  );

  // Fill the editor from the saved reflection: once per verse and person, and again when it was
  // changed elsewhere while there are no unsaved edits here.
  const hydratedFor = useRef<string | null>(null);
  const baseRef = useRef(base);
  baseRef.current = base;
  useEffect(() => {
    if (!persisted || !reflectionQuery.isSuccess) return;
    const data = reflectionQuery.data;
    const key = JSON.stringify(reflectionKey(owner));
    const first = hydratedFor.current !== key;
    hydratedFor.current = key;
    if (first && dirtyRef.current) {
      // Text typed before signing in stays on screen; saving it asks first if this verse already
      // has a note in the account (the save meets that note as a conflict).
      setBase(null);
      return;
    }
    const sameVersion =
      data?.id === baseRef.current?.id && data?.updatedAt === baseRef.current?.updatedAt;
    if (!first && (dirtyRef.current || sameVersion)) return;
    applyReflection(data);
  }, [
    persisted,
    reflectionQuery.isSuccess,
    reflectionQuery.data,
    owner,
    reflectionKey,
    applyReflection,
  ]);

  // When an account signs out or another account signs in, close that account's note: its text
  // must not stay on screen for the next person or be saved somewhere else.
  const previousOwner = useRef(owner);
  useEffect(() => {
    const before = previousOwner.current;
    previousOwner.current = owner;
    if (before === owner || before === "guest") return;
    applyReflection(null);
    hydratedFor.current = null;
    showToast("Signed out of that account — its note was closed");
  }, [owner, applyReflection, showToast]);

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

  const copyAction = (
    <button
      type="button"
      onClick={() => void copyNote()}
      className="rounded-full px-2 py-0.5 font-semibold text-ch-primary-fixed underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ch-primary-fixed"
    >
      Copy note
    </button>
  );

  const defaultNotebookId = notebooks.find((item) => item.isDefault)?.id ?? null;
  const notebookId =
    notebook && notebooks.some((item) => item.id === notebook) ? notebook : defaultNotebookId;

  const save = useMutation({
    mutationFn: (vars: {
      owner: string;
      userId: string | undefined;
      draft: ReflectionDraft;
      base: SavedBase | null;
      saved: string;
    }) => journal.saveReflection(verseKey, vars.draft, vars.base, vars.userId),
    onSuccess: (result, vars) => {
      if (vars.owner !== previousOwner.current) return; // the account changed meanwhile
      if (result.status === "saved") {
        setBase({ id: result.reflection.id, updatedAt: result.reflection.updatedAt });
        setSnapshot(vars.saved);
        setSaveState("idle");
        queryClient.setQueryData(reflectionKey(vars.owner), result.reflection);
        void queryClient.invalidateQueries({ queryKey: ["reflections"] });
        showToast("Reflection saved");
        return;
      }
      const current = result.current;
      setBase(current ? { id: current.id, updatedAt: current.updatedAt } : null);
      setSaveState("conflict");
      queryClient.setQueryData(reflectionKey(vars.owner), current);
      showToast(
        current
          ? "This note changed on another device. Your text is still here — Save again to replace it."
          : "This note was deleted on another device. Save again to keep your text.",
        copyAction,
      );
    },
    onError: (error, vars) => {
      if (vars.owner !== previousOwner.current) return;
      if (error instanceof JournalError) {
        showToast(error.message);
        return;
      }
      setSaveState("failed");
      showToast("Couldn’t save — your reflection is still here", copyAction);
    },
  });

  const saveNote = () => {
    if (!hasDraft) {
      showToast("Write a reflection first");
      bodyRef.current?.focus();
      return;
    }
    if (!persisted) {
      showToast("Not saved — the journal isn’t connected yet", copyAction);
      return;
    }
    if (save.isPending) return;
    if (!dirty && base && saveState === "idle") {
      showToast("Already saved");
      return;
    }
    if (!notebookId) {
      showToast("Notebooks are still loading — try again in a moment");
      return;
    }
    const state = { ...currentState, notebook: notebook ?? notebookId };
    save.mutate({
      owner,
      userId: user?.id,
      draft: {
        notebookId,
        title: state.title,
        body: state.body,
        tags: state.tags,
        posture: state.posture,
        isPrivate: state.isPrivate,
      },
      base,
      saved: serialise(state),
    });
    setNotebook(state.notebook);
  };

  const remove = useMutation({
    mutationFn: (vars: { owner: string; userId: string | undefined; id: string }) =>
      journal.deleteReflection(vars.id, vars.userId),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["reflections"] });
      if (vars.owner !== previousOwner.current) return;
      queryClient.setQueryData(reflectionKey(vars.owner), null);
      applyReflection(null);
      showToast("Reflection deleted");
    },
    onError: () => showToast("Couldn’t delete the reflection. Try again."),
  });

  const deleteReflection = () => {
    if (!base || remove.isPending) return;
    if (!window.confirm("Delete this reflection? This can’t be undone.")) return;
    remove.mutate({ owner, userId: user?.id, id: base.id });
  };

  const clearDraft = () => {
    if (base) {
      applyReflection(reflectionQuery.data ?? null);
      showToast("Changes discarded");
      return;
    }
    setSubtitle("");
    setBody("");
    setSelectedTags(new Set());
    setCustomTags([]);
    setPosture(null);
    setEditing(false);
    showToast("Draft cleared");
  };

  const leave = () => {
    if (persisted) {
      if (
        dirty &&
        !window.confirm("Leave without saving? Your changes to this reflection will be lost.")
      )
        return;
    } else if (
      hasDraft &&
      !window.confirm(
        "Leave this reflection? It hasn’t been saved — the journal isn’t connected yet.",
      )
    ) {
      return;
    }
    goBack();
  };

  // --- notebooks -----------------------------------------------------------------------------------
  const [notebookMode, setNotebookMode] = useState<"idle" | "create" | "rename">("idle");
  const [notebookName, setNotebookName] = useState("");
  const [notebookError, setNotebookError] = useState<string | null>(null);
  const reflectionsQuery = useQuery({
    queryKey: ["reflections", owner],
    queryFn: () => journal.listReflections(user?.id),
    enabled: notebooksOpen && persisted && !authLoading,
  });
  const notebookFailure = (error: unknown, fallback: string) =>
    setNotebookError(error instanceof JournalError ? error.message : fallback);

  const createNotebook = useMutation({
    mutationFn: (name: string) => journal.createNotebook(name, user?.id),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setNotebook(created.id);
      setNotebookMode("idle");
      setNotebookError(null);
      touch();
    },
    onError: (error) => notebookFailure(error, "Couldn’t create the notebook. Try again."),
  });
  const renameNotebook = useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      journal.renameNotebook(vars.id, vars.name, user?.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setNotebookMode("idle");
      setNotebookError(null);
    },
    onError: (error) => notebookFailure(error, "Couldn’t rename the notebook. Try again."),
  });
  const deleteNotebook = useMutation({
    mutationFn: async (id: string) => {
      await journal.deleteNotebook(id, user?.id);
      // The note's notebook (and saved time) may have changed: reload it for the next save.
      return { id, fresh: await journal.getReflection(verseKey, user?.id) };
    },
    onSuccess: ({ id, fresh }) => {
      void queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      void queryClient.invalidateQueries({ queryKey: ["reflections"] });
      if (notebook === id) setNotebook(fresh?.notebookId ?? null);
      if (fresh && base && fresh.id === base.id) {
        setBase({ id: fresh.id, updatedAt: fresh.updatedAt });
        setSnapshot((saved) =>
          serialise({ ...(JSON.parse(saved) as DraftState), notebook: fresh.notebookId }),
        );
        queryClient.setQueryData(reflectionKey(owner), fresh);
      }
      setNotebookError(null);
      showToast(`Notebook deleted — its reflections are in ${DEFAULT_NOTEBOOK_NAME}`);
    },
    onError: (error) => notebookFailure(error, "Couldn’t delete the notebook. Try again."),
  });
  const selectedNotebook = notebooks.find((item) => item.id === notebookId) ?? null;
  const notebookBusy =
    createNotebook.isPending || renameNotebook.isPending || deleteNotebook.isPending;

  const confirmDeleteNotebook = () => {
    if (!selectedNotebook || selectedNotebook.isDefault) return;
    const count = reflectionsQuery.data?.filter(
      (item) => item.notebookId === selectedNotebook.id,
    ).length;
    const moves =
      count === undefined
        ? "Its reflections will move to"
        : count === 0
          ? "It has no reflections. Anything added later goes to"
          : `Its ${count} reflection${count === 1 ? "" : "s"} will move to`;
    if (!window.confirm(`Delete “${selectedNotebook.name}”? ${moves} ${DEFAULT_NOTEBOOK_NAME}.`))
      return;
    deleteNotebook.mutate(selectedNotebook.id);
  };

  const toneDetails = (() => {
    const saved = highlightQuery.data?.[verseNumber];
    const tone = search.tone ?? saved;
    return tone ? toneInfo(tone) : null;
  })();
  const notebookLabel = persisted
    ? (selectedNotebook?.name ?? DEFAULT_NOTEBOOK_NAME)
    : DEFAULT_NOTEBOOK_NAME;
  const notebookNote = !persisted
    ? "Preview · not connected yet"
    : user
      ? "Synced with your account"
      : "Kept on this device";
  const networkProblem =
    verseQuery.error instanceof BibleServiceError && verseQuery.error.kind === "network";

  const status = !persisted
    ? editing
      ? STATUS_EDITING
      : hasDraft
        ? STATUS_DRAFT
        : STATUS_PREVIEW
    : save.isPending
      ? STATUS_SAVING
      : editing
        ? STATUS_EDITING
        : saveState === "failed"
          ? STATUS_FAILED
          : saveState === "conflict"
            ? STATUS_CONFLICT
            : dirty
              ? base
                ? STATUS_UNSAVED
                : STATUS_NEW
              : base
                ? `Saved · ${savedLabel(reflectionQuery.data?.updatedAt ?? new Date().toISOString())}`
                : STATUS_NEW;

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
                  disabled={base ? !dirty : !hasDraft}
                  onSelect={clearDraft}
                >
                  {base ? "Discard changes" : "Clear draft"}
                </DropdownMenu.Item>
                {persisted && base ? (
                  <DropdownMenu.Item
                    className={`${MENU_ITEM} text-ch-error`}
                    disabled={remove.isPending}
                    onSelect={deleteReflection}
                  >
                    Delete reflection
                  </DropdownMenu.Item>
                ) : null}
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

          <EditorStatus status={status} editing={editing || save.isPending} />

          <section aria-label="Reflection" className={`${CARD} relative flex flex-col p-6`}>
            <div className="relative flex min-h-[160px] flex-col">
              <textarea
                ref={bodyRef}
                aria-label="Reflection"
                value={body}
                rows={5}
                maxLength={20000}
                onChange={(event) => {
                  setBody(event.target.value);
                  touch();
                }}
                placeholder="Pour out your heart, observations, prayer requests, or personal action steps..."
                className="min-h-[160px] w-full resize-none overflow-hidden bg-transparent text-base leading-relaxed text-ch-on-surface placeholder:text-ch-outline/60 selection:bg-brand-primary-soft focus:outline-none"
              />
            </div>
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
            notebookName={notebookLabel}
            notebookNote={notebookNote}
            onOpenNotebooks={() => setNotebooksOpen(true)}
            notebookButtonRef={notebookButtonRef}
            isPrivate={isPrivate}
            onTogglePrivate={() => {
              setIsPrivate((current) => !current);
              touch();
            }}
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
        open={notebooksOpen}
        onOpenChange={(open) => {
          setNotebooksOpen(open);
          if (!open) {
            setNotebookMode("idle");
            setNotebookError(null);
          }
        }}
        title="Notebook"
        description={
          persisted
            ? "Choose where this reflection is kept"
            : "Preview — notebooks aren’t connected yet"
        }
        name="notebook"
        options={
          persisted
            ? notebooks.map((item) => ({ id: item.id, label: item.name }))
            : [{ id: "general", label: DEFAULT_NOTEBOOK_NAME }]
        }
        value={persisted ? notebookId : "general"}
        onChange={(id) => {
          if (!persisted) return;
          setNotebook(id);
          setNotebooksOpen(false);
          touch();
        }}
        returnFocusRef={notebookButtonRef}
        {...(persisted
          ? {
              footer: (
                <NotebookActions
                  mode={notebookMode}
                  name={notebookName}
                  onNameChange={(name) => {
                    setNotebookName(name);
                    setNotebookError(null);
                  }}
                  onSubmit={() => {
                    if (notebookMode === "create") createNotebook.mutate(notebookName);
                    else if (selectedNotebook)
                      renameNotebook.mutate({ id: selectedNotebook.id, name: notebookName });
                  }}
                  onCancel={() => {
                    setNotebookMode("idle");
                    setNotebookError(null);
                  }}
                  onStartCreate={() => {
                    setNotebookName("");
                    setNotebookError(null);
                    setNotebookMode("create");
                  }}
                  onStartRename={() => {
                    setNotebookName(selectedNotebook?.name ?? "");
                    setNotebookError(null);
                    setNotebookMode("rename");
                  }}
                  onDelete={confirmDeleteNotebook}
                  selectedName={selectedNotebook?.name ?? null}
                  canDelete={Boolean(selectedNotebook && !selectedNotebook.isDefault)}
                  error={notebookError}
                  busy={notebookBusy}
                />
              ),
            }
          : {})}
      />
    </div>
  );
}
