import { supabase } from "@/integrations/supabase/client";
import { ACCOUNT_JOURNAL_ENABLED } from "./journal-schema";
import { assertStillSignedInAs } from "./session-guard";

/*
 * Reflection Journal: notebooks and reflections (one reflection per verse and translation).
 * Guests keep theirs on this device; signed-in journals live in the account's RLS-protected
 * `notebooks` and `reflections` tables and are read fresh on every device. Account data is never
 * stored on the device.
 *
 * Every person has one "General Reflections" notebook that can't be deleted; deleting another
 * notebook moves its reflections there. Saving checks that the note hasn't changed elsewhere
 * since it was opened (updated_at), so an older copy never silently replaces a newer one.
 */

export const DEFAULT_NOTEBOOK_NAME = "General Reflections";
/** The guest default notebook's id (guest-only; it maps to the account's default on merge). */
export const GUEST_DEFAULT_NOTEBOOK_ID = "general";
export const GUEST_JOURNAL_KEY = "versesnap.journal.v1";
export const NOTEBOOK_NAME_MAX = 60;
export const TITLE_MAX = 120;
export const BODY_MAX = 20000;
export const TAGS_MAX = 20;

export interface VerseKey {
  translation: string;
  bookId: string;
  chapter: number;
  verse: number;
}

export interface Notebook {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Reflection extends VerseKey {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  tags: string[];
  posture: string | null;
  isPrivate: boolean;
  createdAt: string;
  /** Exactly as stored (kept as text: it is compared when saving). */
  updatedAt: string;
}

export interface ReflectionDraft {
  notebookId: string;
  title: string;
  body: string;
  tags: string[];
  posture: string | null;
  isPrivate: boolean;
}

/** The saved version an edit started from: saving fails safely if it changed meanwhile. */
export interface SavedBase {
  id: string;
  updatedAt: string;
}

export type SaveResult =
  | { status: "saved"; reflection: Reflection }
  /** Changed or deleted elsewhere since it was opened; `current` is what is stored now. */
  | { status: "conflict"; current: Reflection | null };

export type JournalErrorCode =
  "empty" | "too-long" | "name-invalid" | "name-taken" | "default-notebook";

export class JournalError extends Error {
  constructor(
    readonly code: JournalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JournalError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function verseKeyId(key: VerseKey): string {
  return `${key.translation}/${key.bookId}/${key.chapter}/${key.verse}`;
}

export function normaliseNotebookName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > NOTEBOOK_NAME_MAX)
    throw new JournalError(
      "name-invalid",
      `A notebook name needs 1 to ${NOTEBOOK_NAME_MAX} characters`,
    );
  return trimmed;
}

function validateDraft(draft: ReflectionDraft): ReflectionDraft {
  if (!draft.title.trim() && !draft.body.trim())
    throw new JournalError("empty", "Write a reflection first");
  if (draft.title.length > TITLE_MAX || draft.body.length > BODY_MAX)
    throw new JournalError("too-long", "This reflection is too long to save");
  if (draft.tags.length > TAGS_MAX)
    throw new JournalError("too-long", `Choose up to ${TAGS_MAX} tags`);
  return draft;
}

const byNotebookOrder = (a: Notebook, b: Notebook) =>
  Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name);
const newestFirst = (a: Reflection, b: Reflection) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

// --- guest journal (this device) -------------------------------------------------------------------

export interface GuestJournal {
  notebooks: Notebook[];
  reflections: Reflection[];
}

function guestDefaultNotebook(): Notebook {
  const at = now();
  return {
    id: GUEST_DEFAULT_NOTEBOOK_ID,
    name: DEFAULT_NOTEBOOK_NAME,
    isDefault: true,
    createdAt: at,
    updatedAt: at,
  };
}

function isNotebook(value: unknown): value is Notebook {
  const item = value as Partial<Notebook> | null;
  return (
    !!item &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    // The default keeps its fixed id; every other guest notebook has a UUID (kept on import).
    (item.isDefault === true ? item.id === GUEST_DEFAULT_NOTEBOOK_ID : isUuid(item.id))
  );
}

function isReflection(value: unknown): value is Reflection {
  const item = value as Partial<Reflection> | null;
  return (
    !!item &&
    isUuid(item.id) &&
    typeof item.notebookId === "string" &&
    typeof item.translation === "string" &&
    typeof item.bookId === "string" &&
    Number.isInteger(item.chapter) &&
    Number.isInteger(item.verse) &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === "string") &&
    (item.posture === null || typeof item.posture === "string") &&
    typeof item.isPrivate === "boolean" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

/** Reads the guest journal: always has its default notebook; orphaned notes go to General. */
function readGuest(): GuestJournal {
  let raw: Partial<GuestJournal> = {};
  if (typeof window !== "undefined") {
    try {
      raw = (JSON.parse(window.localStorage.getItem(GUEST_JOURNAL_KEY) ?? "{}") ??
        {}) as Partial<GuestJournal>;
    } catch {
      raw = {};
    }
  }
  const notebooks = (Array.isArray(raw.notebooks) ? raw.notebooks : []).filter(isNotebook);
  if (!notebooks.some((notebook) => notebook.isDefault)) notebooks.unshift(guestDefaultNotebook());
  const known = new Set(notebooks.map((notebook) => notebook.id));
  const reflections = (Array.isArray(raw.reflections) ? raw.reflections : [])
    .filter(isReflection)
    .map((reflection) =>
      known.has(reflection.notebookId)
        ? reflection
        : { ...reflection, notebookId: GUEST_DEFAULT_NOTEBOOK_ID },
    );
  return { notebooks, reflections };
}

function writeGuest(journal: GuestJournal): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_JOURNAL_KEY, JSON.stringify(journal));
}

/** Direct access to this device's guest journal, for the guest-to-account merge. */
export const guestJournal = {
  read(): GuestJournal {
    return readGuest();
  },
  /** True when the device holds anything worth offering (a reflection or a named notebook). */
  hasContent(): boolean {
    const journal = readGuest();
    return (
      journal.reflections.length > 0 || journal.notebooks.some((notebook) => !notebook.isDefault)
    );
  },
  /** Removes only the given reflections, re-reading first so changes made meanwhile are kept. */
  removeReflections(ids: readonly string[]): void {
    const drop = new Set(ids);
    const journal = readGuest();
    writeGuest({
      ...journal,
      reflections: journal.reflections.filter((item) => !drop.has(item.id)),
    });
  },
  /** Removes notebooks (never the default); any reflections still in them move to General. */
  removeNotebooks(ids: readonly string[]): void {
    const drop = new Set(ids);
    const journal = readGuest();
    writeGuest({
      notebooks: journal.notebooks.filter((item) => item.isDefault || !drop.has(item.id)),
      reflections: journal.reflections.map((item) =>
        drop.has(item.notebookId) ? { ...item, notebookId: GUEST_DEFAULT_NOTEBOOK_ID } : item,
      ),
    });
  },
};

// --- account journal ---------------------------------------------------------------------------------

interface NotebookRow {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface ReflectionRow {
  id: string;
  notebook_id: string;
  translation: string;
  book_id: string;
  chapter: number;
  verse: number;
  title: string;
  body: string;
  tags: string[];
  posture: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

const toNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  name: row.name,
  isDefault: row.is_default,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toReflection = (row: ReflectionRow): Reflection => ({
  id: row.id,
  notebookId: row.notebook_id,
  translation: row.translation,
  bookId: row.book_id,
  chapter: row.chapter,
  verse: row.verse,
  title: row.title,
  body: row.body,
  tags: row.tags ?? [],
  posture: row.posture,
  isPrivate: row.is_private,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const draftColumns = (draft: ReflectionDraft) => ({
  notebook_id: draft.notebookId,
  title: draft.title,
  body: draft.body,
  tags: draft.tags,
  posture: draft.posture,
  is_private: draft.isPrivate,
});

const isDuplicate = (error: { code?: string } | null) => error?.code === "23505";

function requireAccountJournal(): void {
  if (!ACCOUNT_JOURNAL_ENABLED) throw new Error("The account journal isn’t enabled");
}

async function accountNotebooks(): Promise<Notebook[]> {
  const { data, error } = await supabase
    .from("notebooks")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toNotebook(row as NotebookRow));
}

/** The account's notebooks, creating "General Reflections" the first time (once, even if two
 * devices try at the same moment: the database allows one default per person). */
export async function ensureAccountNotebooks(userId: string): Promise<Notebook[]> {
  let notebooks = await accountNotebooks();
  if (notebooks.some((notebook) => notebook.isDefault)) return notebooks;
  await assertStillSignedInAs(userId);
  const { error } = await supabase.from("notebooks").insert({
    id: newId(),
    user_id: userId,
    name: DEFAULT_NOTEBOOK_NAME,
    is_default: true,
  });
  if (error && !isDuplicate(error)) throw error;
  notebooks = await accountNotebooks();
  if (!notebooks.some((notebook) => notebook.isDefault))
    throw new Error("Couldn’t create the General Reflections notebook");
  return notebooks;
}

async function accountReflection(key: VerseKey): Promise<Reflection | null> {
  const { data, error } = await supabase
    .from("reflections")
    .select("*")
    .eq("translation", key.translation)
    .eq("book_id", key.bookId)
    .eq("chapter", key.chapter)
    .eq("verse", key.verse)
    .maybeSingle();
  if (error) throw error;
  return data ? toReflection(data as ReflectionRow) : null;
}

// --- the journal ---------------------------------------------------------------------------------------

export const journal = {
  /** Whether reflections are kept for this person: always for guests; accounts once enabled. */
  persists(userId?: string): boolean {
    return !userId || ACCOUNT_JOURNAL_ENABLED;
  },

  /** Notebooks, General first then by name. Empty for an account before the journal is enabled. */
  async listNotebooks(userId?: string): Promise<Notebook[]> {
    if (!userId) return readGuest().notebooks.sort(byNotebookOrder);
    if (!ACCOUNT_JOURNAL_ENABLED) return [];
    return (await ensureAccountNotebooks(userId)).sort(byNotebookOrder);
  },

  async createNotebook(name: string, userId?: string): Promise<Notebook> {
    const clean = normaliseNotebookName(name);
    const taken = () =>
      new JournalError("name-taken", `You already have a notebook called “${clean}”`);
    if (!userId) {
      const guest = readGuest();
      if (guest.notebooks.some((notebook) => notebook.name.toLowerCase() === clean.toLowerCase()))
        throw taken();
      const at = now();
      const notebook: Notebook = {
        id: newId(),
        name: clean,
        isDefault: false,
        createdAt: at,
        updatedAt: at,
      };
      writeGuest({ ...guest, notebooks: [...guest.notebooks, notebook] });
      return notebook;
    }
    requireAccountJournal();
    await assertStillSignedInAs(userId);
    const { data, error } = await supabase
      .from("notebooks")
      .insert({ id: newId(), user_id: userId, name: clean })
      .select()
      .single();
    if (isDuplicate(error)) throw taken();
    if (error) throw error;
    return toNotebook(data as NotebookRow);
  },

  async renameNotebook(id: string, name: string, userId?: string): Promise<void> {
    const clean = normaliseNotebookName(name);
    const taken = () =>
      new JournalError("name-taken", `You already have a notebook called “${clean}”`);
    if (!userId) {
      const guest = readGuest();
      if (
        guest.notebooks.some(
          (notebook) => notebook.id !== id && notebook.name.toLowerCase() === clean.toLowerCase(),
        )
      )
        throw taken();
      writeGuest({
        ...guest,
        notebooks: guest.notebooks.map((notebook) =>
          notebook.id === id ? { ...notebook, name: clean, updatedAt: now() } : notebook,
        ),
      });
      return;
    }
    requireAccountJournal();
    await assertStillSignedInAs(userId);
    const { error } = await supabase
      .from("notebooks")
      .update({ name: clean, updated_at: now() })
      .eq("id", id);
    if (isDuplicate(error)) throw taken();
    if (error) throw error;
  },

  /** Deletes a notebook; its reflections move to General Reflections. General can't be deleted. */
  async deleteNotebook(id: string, userId?: string): Promise<void> {
    const refuse = () =>
      new JournalError("default-notebook", `${DEFAULT_NOTEBOOK_NAME} can’t be deleted`);
    if (!userId) {
      const guest = readGuest();
      if (guest.notebooks.find((notebook) => notebook.id === id)?.isDefault) throw refuse();
      guestJournal.removeNotebooks([id]);
      return;
    }
    requireAccountJournal();
    await assertStillSignedInAs(userId);
    // The database moves the reflections (trigger) and refuses the default notebook.
    const { error } = await supabase.from("notebooks").delete().eq("id", id).eq("user_id", userId);
    if (error && /can.t be deleted/.test(error.message)) throw refuse();
    if (error) throw error;
  },

  async getReflection(key: VerseKey, userId?: string): Promise<Reflection | null> {
    if (!userId) {
      const id = verseKeyId(key);
      return readGuest().reflections.find((item) => verseKeyId(item) === id) ?? null;
    }
    if (!ACCOUNT_JOURNAL_ENABLED) return null;
    return accountReflection(key);
  },

  /** All reflections, most recently edited first. */
  async listReflections(userId?: string): Promise<Reflection[]> {
    if (!userId) return readGuest().reflections.sort(newestFirst);
    if (!ACCOUNT_JOURNAL_ENABLED) return [];
    const { data, error } = await supabase
      .from("reflections")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data ?? []).map((row) => toReflection(row as ReflectionRow));
  },

  /**
   * Saves the reflection for a verse. `base` is the saved version the edit started from (null
   * for a new note); if the note changed or was created elsewhere meanwhile, nothing is written
   * and the stored version is returned as a conflict, so the caller can let the person decide.
   */
  async saveReflection(
    key: VerseKey,
    input: ReflectionDraft,
    base: SavedBase | null,
    userId?: string,
  ): Promise<SaveResult> {
    const draft = validateDraft(input);
    const at = now();
    if (!userId) {
      const guest = readGuest();
      const id = verseKeyId(key);
      const current = guest.reflections.find((item) => verseKeyId(item) === id) ?? null;
      if (current?.id !== base?.id || (current && current.updatedAt !== base?.updatedAt))
        return { status: "conflict", current };
      const notebookId = guest.notebooks.some((notebook) => notebook.id === draft.notebookId)
        ? draft.notebookId
        : GUEST_DEFAULT_NOTEBOOK_ID;
      const reflection: Reflection = {
        ...key,
        ...draft,
        notebookId,
        id: current?.id ?? newId(),
        createdAt: current?.createdAt ?? at,
        updatedAt: at,
      };
      writeGuest({
        ...guest,
        reflections: [reflection, ...guest.reflections.filter((item) => item.id !== reflection.id)],
      });
      return { status: "saved", reflection };
    }
    requireAccountJournal();
    await assertStillSignedInAs(userId);
    if (base) {
      const { data, error } = await supabase
        .from("reflections")
        .update({ ...draftColumns(draft), updated_at: at })
        .eq("id", base.id)
        .eq("updated_at", base.updatedAt)
        .select();
      if (error) throw error;
      if (data && data.length === 1)
        return { status: "saved", reflection: toReflection(data[0] as ReflectionRow) };
      return { status: "conflict", current: await accountReflection(key) };
    }
    const { data, error } = await supabase
      .from("reflections")
      .insert({
        id: newId(),
        user_id: userId,
        translation: key.translation,
        book_id: key.bookId,
        chapter: key.chapter,
        verse: key.verse,
        ...draftColumns(draft),
        created_at: at,
        updated_at: at,
      })
      .select()
      .single();
    if (isDuplicate(error)) return { status: "conflict", current: await accountReflection(key) };
    if (error) throw error;
    return { status: "saved", reflection: toReflection(data as ReflectionRow) };
  },

  async deleteReflection(id: string, userId?: string): Promise<void> {
    if (!userId) {
      guestJournal.removeReflections([id]);
      return;
    }
    requireAccountJournal();
    await assertStillSignedInAs(userId);
    const { error } = await supabase
      .from("reflections")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
  },
};
