import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

interface VerseRowProps {
  translation: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  preview?: string;
  trailing?: React.ReactNode;
}

export function VerseRow({
  translation,
  bookId,
  bookName,
  chapter,
  verse,
  preview,
  trailing,
}: VerseRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border last:border-b-0">
      <Link
        to="/verse/$translation/$book/$chapter/$verse"
        params={{
          translation,
          book: bookId,
          chapter: String(chapter),
          verse: String(verse),
        }}
        className="flex min-w-0 items-center gap-2 py-3.5 pr-1"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium">
            {bookName} {chapter}:{verse}
          </span>
          {preview ? (
            <span className="mt-0.5 block truncate font-serif text-sm text-muted-foreground">
              {preview}
            </span>
          ) : null}
        </span>
        {trailing ? null : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </Link>
      {trailing}
    </div>
  );
}
