import { useRef, type FormEvent } from "react";
import { CloseIcon, SearchIcon } from "@/components/stitch-icons";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * Pill search input from Stitch "19 — Search No Results"; the magnifier is the submit button.
 * Progressive enhancement: without JavaScript (or before hydration) the form is a plain GET to
 * /search?q=..., so a submission is never lost. Once the page is live, onSubmit takes over.
 */
export function SearchField({ value, onChange, onSubmit }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <form method="get" action="/search" onSubmit={onSubmit} role="search" className="w-full">
      <div className="flex h-12 w-full items-center rounded-full border border-vs-border bg-vs-surface pl-1.5 pr-3 shadow-sm focus-within:border-vs-primary focus-within:ring-1 focus-within:ring-vs-primary">
        <button
          type="submit"
          aria-label="Search the Bible"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-vs-icon-muted transition-colors hover:text-vs-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SearchIcon className="h-5 w-5" strokeWidth={2} />
        </button>
        <input
          ref={inputRef}
          name="q"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search verses, references..."
          aria-label="Bible reference or description"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={500}
          className="ml-0.5 min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-medium text-vs-text placeholder:text-vs-icon-muted focus:outline-none focus:ring-0"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-vs-border text-vs-text-secondary transition-colors hover:bg-vs-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </form>
  );
}
