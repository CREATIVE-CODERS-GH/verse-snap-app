import { ArrowLeftIcon } from "@/components/stitch-icons";

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
}

/** Top bar of a pushed screen in the Stitch designs: back button, centred Playfair title. */
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-vs-border/50 bg-vs-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-[30rem] items-center justify-between px-4">
        <button
          type="button"
          aria-label="Go back"
          onClick={onBack}
          className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-vs-text transition-all hover:bg-vs-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <ArrowLeftIcon className="h-6 w-6" />
        </button>
        <h1 className="flex-1 truncate text-center font-display text-lg font-bold tracking-tight text-vs-text">
          {title}
        </h1>
        <div className="-mr-1 w-10" aria-hidden />
      </div>
    </header>
  );
}
