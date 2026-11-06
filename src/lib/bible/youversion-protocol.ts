import { z } from "zod";
import type { ParsedVerse } from "./youversion-html";

/** What the browser asks the server for: one chapter of one licensed edition. */
export const youVersionChapterRequestSchema = z.object({
  translation: z.string().min(1).max(12),
  bookId: z.string().min(1).max(32),
  chapter: z.number().int().min(1).max(200),
});

export type YouVersionChapterRequest = z.infer<typeof youVersionChapterRequestSchema>;

export type YouVersionFailureKind = "network" | "translation" | "reference" | "provider";

/**
 * The server never throws to the browser. Failures come back as data with a fixed, user-safe message
 * (never the API's own text, headers or key), and the client maps them to BibleServiceError.
 */
export type YouVersionChapterResult =
  | { ok: true; verses: ParsedVerse[] }
  | { ok: false; kind: YouVersionFailureKind; message: string; retryAfterSeconds?: number };
