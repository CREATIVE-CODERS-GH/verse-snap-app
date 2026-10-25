import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { MORE_BUTTON_CLASS } from "@/components/reflection-parts";
import { LoadingState } from "@/components/search-states";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CameraIcon,
  CheckIcon,
  CopyDocIcon,
  DownloadIcon,
  ShareNodesIcon,
} from "@/components/stitch-icons";
import { findBook } from "@/lib/bible/books";
import { bibleService } from "@/lib/bible/service";
import type { Verse } from "@/lib/bible/types";
import { trackEvent } from "@/lib/analytics";
import { copyText } from "@/lib/copy-text";
import { verseShareText } from "@/lib/share-verse-card";
import { useBackOrHome } from "@/lib/use-back-or-home";
import { cn } from "@/lib/utils";
import {
  CARD_FORMATS,
  CARD_THEMES,
  CARD_TYPES,
  cardFileName,
  cardTheme,
  renderVerseCard,
  type CardFormat,
  type CardOptions,
  type CardTheme,
  type CardType,
} from "@/lib/verse-card-render";

/*
 * Verse Card Creator Studio — Stitch "26". A live preview of the card (format, theme, typography,
 * text scale) and exports that render the same card as a PNG on the device.
 */

export const Route = createFileRoute("/card/$translation/$book/$chapter/$verse")({
  head: ({ params }) => ({
    meta: [
      {
        title: `Verse Card · ${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse} — Verse Snap`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CardStudioPage,
});

const SCALES = [
  { max: 0.9, label: "Small" },
  { max: 1.1, label: "Medium" },
  { max: 1.3, label: "Large" },
];

function SectionTitle({ children, aside }: { children: ReactNode; aside?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-text">
        {children}
      </h2>
      {aside ? <span className="text-[12px] font-semibold text-brand-primary">{aside}</span> : null}
    </div>
  );
}

function CardStudioPage() {
  const params = Route.useParams();
  const goBack = useBackOrHome();
  const book = findBook(params.book);
  const ref = {
    bookId: params.book,
    bookName: book?.name ?? params.book,
    chapter: Number(params.chapter),
    verse: Number(params.verse),
  };
  const query = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(ref, params.translation),
    retry: 1,
  });
  const verse = query.data;

  const [options, setOptions] = useState<CardOptions>({
    theme: "pine",
    format: "story",
    type: "serif",
    scale: 1,
  });
  const [busy, setBusy] = useState(false);
  const theme = cardTheme(options.theme);
  const set = (patch: Partial<CardOptions>) => setOptions((current) => ({ ...current, ...patch }));
  const scaleLabel = SCALES.find((item) => options.scale <= item.max)?.label ?? "Large";

  async function exportCard(mode: "share" | "save" | "story", card: Verse) {
    if (busy) return;
    setBusy(true);
    const format: CardFormat = mode === "story" ? "story" : options.format;
    try {
      const blob = await renderVerseCard(card, { ...options, format });
      const file = new File([blob], cardFileName(card, format), { type: "image/png" });
      trackEvent("verse_shared", { target: mode === "story" ? "story" : "card" });
      const canShareFile =
        typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
      if (mode !== "save" && canShareFile) {
        await navigator.share({ files: [file], title: card.reference, text: verseShareText(card) });
        toast("Exported successfully");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      toast(
        mode === "story"
          ? "Story image saved — post it from Instagram"
          : mode === "save"
            ? "Photo saved"
            : "Image downloaded",
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast("Could not create the card");
    } finally {
      setBusy(false);
    }
  }

  const copy = async (card: Verse) => {
    try {
      await copyText(verseShareText(card));
      trackEvent("verse_copied");
      toast("Copied");
    } catch {
      toast("Could not copy this verse");
    }
  };

  // The preview scales its text with its own width (container units), like the exported image.
  const previewStyle: CSSProperties = { aspectRatio: CARD_FORMATS[options.format].ratio };
  const verseStyle: CSSProperties = {
    color: theme.text,
    fontSize: `calc(${(6.2 * options.scale).toFixed(2)}cqw)`,
  };

  return (
    <div className="min-h-dvh bg-brand-canvas font-stitch text-brand-text">
      <header className="sticky top-0 z-40 bg-brand-canvas/85 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-2 px-5">
          <button
            type="button"
            aria-label="Go back"
            onClick={goBack}
            className={`-ml-1 ${MORE_BUTTON_CLASS}`}
          >
            <ArrowLeftIcon className="h-[22px] w-[22px]" />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-medium">
            Verse Card Creator Studio
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="font-display text-xl font-semibold leading-tight">Verse Studio</p>
            <p className="text-[12px] text-brand-text-muted">
              {ref.bookName} {ref.chapter}:{ref.verse} Customizer
            </p>
          </div>
          <button
            type="button"
            disabled={!verse || busy}
            onClick={() => verse && void exportCard("share", verse)}
            className="flex items-center gap-1.5 rounded-full bg-brand-primary px-4 py-2 text-[14px] font-semibold text-brand-on-primary shadow-sm transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas disabled:opacity-60"
          >
            <ShareNodesIcon className="h-4 w-4" />
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>

        <div role="radiogroup" aria-label="Card format" className="mb-4 grid grid-cols-3 gap-2">
          {(Object.keys(CARD_FORMATS) as CardFormat[]).map((format) => {
            const active = options.format === format;
            const [ratio, ...name] = CARD_FORMATS[format].label.split(" ");
            return (
              <button
                key={format}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ format })}
                className={cn(
                  "flex flex-col items-center rounded-xl py-2 text-[12.5px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
                  active
                    ? "bg-brand-primary text-brand-on-primary"
                    : "bg-brand-surface-muted text-brand-text-muted hover:bg-brand-surface-sunken",
                )}
              >
                <span>{ratio}</span>
                <span className="font-medium">{name.join(" ")}</span>
              </button>
            );
          })}
        </div>

        {/* Live preview */}
        <div className="mx-auto mb-6 w-full max-w-[340px]">
          {verse ? (
            <figure
              aria-label={`Preview of the ${theme.name} verse card`}
              style={previewStyle}
              className="relative flex w-full flex-col overflow-hidden rounded-3xl shadow-xl [container-type:inline-size]"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to bottom, ${theme.stops[0]}, ${theme.stops[1]})`,
                }}
              />
              {theme.photo ? (
                <>
                  <img
                    src={theme.photo}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-black/60" />
                </>
              ) : null}
              <div className="relative flex flex-1 flex-col p-[8cqw]" style={{ color: theme.text }}>
                <span
                  className="w-fit rounded-full px-[3cqw] py-[1cqw] text-[3cqw] font-semibold"
                  style={{ background: theme.chip }}
                >
                  {verse.translation}
                </span>
                <blockquote
                  className={cn("my-auto text-center leading-[1.4]", CARD_TYPES[options.type].css)}
                  style={verseStyle}
                >
                  <span
                    className="block leading-none"
                    style={{ color: theme.muted, fontSize: "1.6em" }}
                    aria-hidden
                  >
                    “
                  </span>
                  {verse.text}
                </blockquote>
                <div className="flex items-center justify-between text-[3.2cqw] font-semibold">
                  <span className="flex items-center gap-[1.5cqw]">
                    <BookOpenIcon className="h-[4cqw] w-[4cqw]" aria-hidden />
                    {verse.reference}
                  </span>
                  <span className="text-[2.6cqw] tracking-[0.2em]" style={{ color: theme.muted }}>
                    VERSE SNAP
                  </span>
                </div>
              </div>
            </figure>
          ) : query.isLoading ? (
            <LoadingState />
          ) : (
            <p className="py-16 text-center text-[14px] text-brand-text-muted">
              Couldn’t load this verse. Check your connection and try again.
            </p>
          )}
        </div>

        <section className="mb-6">
          <SectionTitle aside={theme.name}>Theme &amp; Background</SectionTitle>
          <div
            role="radiogroup"
            aria-label="Theme and background"
            className="flex justify-between gap-2"
          >
            {CARD_THEMES.map((item) => {
              const active = options.theme === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={item.name}
                  onClick={() => set({ theme: item.id as CardTheme })}
                  className="group flex flex-col items-center gap-1.5 focus:outline-none"
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full shadow-sm transition-transform group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-brand-focus group-focus-visible:ring-offset-2",
                      active && "ring-2 ring-brand-primary ring-offset-2 ring-offset-brand-canvas",
                    )}
                    style={{ background: item.swatch }}
                  >
                    {active ? (
                      <CheckIcon
                        className="h-5 w-5"
                        style={{ color: item.text === "#ffffff" ? "#ffffff" : item.text }}
                      />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      active ? "font-semibold text-brand-text" : "text-brand-text-muted",
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-6">
          <SectionTitle>Typography Style</SectionTitle>
          <div role="radiogroup" aria-label="Typography style" className="grid grid-cols-3 gap-2">
            {(Object.keys(CARD_TYPES) as CardType[]).map((type) => {
              const active = options.type === type;
              const info = CARD_TYPES[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set({ type })}
                  className={cn(
                    "flex flex-col items-center rounded-xl border py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
                    active
                      ? "border-brand-primary bg-brand-primary text-brand-on-primary"
                      : "border-brand-border bg-brand-surface text-brand-text hover:bg-brand-surface-muted",
                  )}
                >
                  <span className={cn("text-[20px] leading-tight", info.css)}>{info.label}</span>
                  <span
                    className={cn("text-[11px]", active ? "opacity-80" : "text-brand-text-muted")}
                  >
                    {info.note}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-6">
          <SectionTitle aside={scaleLabel}>Text Scale</SectionTitle>
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-brand-text-muted" aria-hidden>
              T
            </span>
            <input
              type="range"
              min={0.8}
              max={1.3}
              step={0.05}
              value={options.scale}
              onChange={(event) => set({ scale: Number(event.target.value) })}
              aria-label="Text scale"
              aria-valuetext={scaleLabel}
              className="h-2 flex-1 cursor-pointer appearance-auto accent-[var(--brand-primary)]"
            />
            <span className="text-[22px] font-semibold text-brand-text" aria-hidden>
              T
            </span>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-brand-text">Instant Export</h2>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { id: "save", label: "Save Photo", icon: <DownloadIcon className="h-6 w-6" /> },
                { id: "story", label: "IG Story", icon: <CameraIcon className="h-6 w-6" /> },
                { id: "copy", label: "Copy", icon: <CopyDocIcon className="h-6 w-6" /> },
              ] as const
            ).map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={!verse || busy}
                onClick={() => {
                  if (!verse) return;
                  if (action.id === "copy") void copy(verse);
                  else void exportCard(action.id, verse);
                }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-brand-border bg-brand-surface py-4 text-[13px] font-medium text-brand-text shadow-sm transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus disabled:opacity-60"
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary-soft text-brand-primary"
                  aria-hidden
                >
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
