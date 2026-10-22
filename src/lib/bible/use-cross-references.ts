import { useQuery } from "@tanstack/react-query";
import { findBook } from "./books";
import { bibleService } from "./service";
import { fetchChapterCrossRefs, fitPassage, type CrossPassage } from "./cross-references";

/** One chapter's cross-references, fetched once and kept (the data does not change). */
export function useChapterCrossRefs(bookId: string, chapter: number, enabled = true) {
  return useQuery({
    queryKey: ["cross-refs", bookId, chapter],
    queryFn: () => fetchChapterCrossRefs(bookId, chapter),
    enabled: enabled && Boolean(findBook(bookId)) && Number.isInteger(chapter) && chapter > 0,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

const NONE: CrossPassage[] = [];

/** The ranked related passages of one verse (all of them; the caller limits what it shows). */
export function useVerseCrossRefs(bookId: string, chapter: number, verse: number, enabled = true) {
  const query = useChapterCrossRefs(bookId, chapter, enabled);
  const passages = query.data?.get(verse) ?? NONE;
  return {
    passages,
    isLoading: enabled && (query.isPending || query.isLoading) && !query.isError,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** The passage as it exists in the reader's edition (end clamped; unavailable if it starts too late). */
export function usePassageFit(passage: CrossPassage, translation: string) {
  const book = findBook(passage.book);
  const { data } = useQuery({
    // The same key as the chapter reader, so a chapter already read is not fetched again.
    queryKey: ["chapter", translation, passage.book, String(passage.chapter)],
    queryFn: () =>
      bibleService.getChapter(
        { bookId: passage.book, bookName: passage.bookName, chapter: passage.chapter },
        translation,
      ),
    enabled: Boolean(book),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const last = data?.verses.reduce((max, verse) => Math.max(max, verse.verse), 0);
  return fitPassage(passage, last && last > 0 ? last : undefined);
}
