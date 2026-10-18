import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  Share2,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findBook } from "@/lib/bible/books";
import { BibleServiceError } from "@/lib/bible/types";
import { bibleService } from "@/lib/bible/service";
import { BIBLE_TRANSLATIONS, translationName } from "@/lib/bible/translations";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";
import { usePreferences } from "@/lib/preferences";
import { trackEvent } from "@/lib/analytics";
import { createVerseImageBlob, verseImageFileName } from "@/lib/share-verse-image";

export const Route = createFileRoute("/verse/$translation/$book/$chapter/$verse")({
  head: ({ params }) => {
    const reference = `${findBook(params.book)?.name ?? params.book} ${params.chapter}:${params.verse}`;
    return {
      meta: [
        { title: `${reference} (${params.translation}) — Verse Snap` },
        {
          name: "description",
          content: `Read ${reference} in the ${params.translation} on Verse Snap.`,
        },
        { property: "og:title", content: `${reference} — Verse Snap` },
        { property: "og:description", content: `Read ${reference} in the ${params.translation}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: VersePage,
});

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function VersePage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { playbackSpeed } = usePreferences();
  const queryClient = useQueryClient();
  const [speaking, setSpeaking] = useState(false);
  const recorded = useRef<string | null>(null);
  const book = findBook(params.book);
  const chapter = Number(params.chapter);
  const verseNumber = Number(params.verse);
  const validParams = Boolean(
    book &&
    Number.isInteger(chapter) &&
    chapter > 0 &&
    Number.isInteger(verseNumber) &&
    verseNumber > 0,
  );
  const ref = useMemo(
    () => ({
      bookId: params.book,
      bookName: book?.name ?? params.book,
      chapter,
      verse: verseNumber,
    }),
    [params.book, book?.name, chapter, verseNumber],
  );

  const verseQuery = useQuery({
    queryKey: ["verse", params.translation, params.book, params.chapter, params.verse],
    queryFn: () => bibleService.getVerse(ref, params.translation),
    enabled: validParams,
    retry: 1,
  });
  const verse = verseQuery.data;

  const { data: neighbours } = useQuery({
    queryKey: ["verse-neighbours", params.translation, params.book, params.chapter, params.verse],
    queryFn: async () => ({
      previous: await bibleService.getNeighbour(ref, -1, params.translation),
      next: await bibleService.getNeighbour(ref, 1, params.translation),
    }),
    enabled: Boolean(verse),
  });
  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });
  const { data: saved } = useQuery({
    queryKey: [
      "saved",
      "is",
      user?.id,
      params.translation,
      params.book,
      params.chapter,
      params.verse,
    ],
    queryFn: () => library.isSaved(ref, params.translation, user?.id),
    enabled: Boolean(verse) && !authLoading,
  });

  const toggleSave = useMutation({
    mutationFn: async () => {
      if (!verse) return;
      if (saved) await library.unsave(ref, params.translation, user?.id);
      else await library.save(verse, user?.id);
    },
    onSuccess: () => {
      if (!saved) trackEvent("verse_saved");
      queryClient.invalidateQueries({ queryKey: ["saved"] });
      toast(saved ? "Removed from saved" : "Saved");
    },
    onError: () => toast("Could not update saved verses"),
  });

  useEffect(() => {
    const key = `${params.translation}/${params.book}/${params.chapter}/${params.verse}/${user?.id ?? "guest"}`;
    if (!verse || authLoading || recorded.current === key) return;
    recorded.current = key;
    trackEvent("verse_opened");
    library
      .recordView(verse, user?.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["history"] }))
      .catch(() => undefined);
  }, [
    authLoading,
    user?.id,
    verse,
    params.translation,
    params.book,
    params.chapter,
    params.verse,
    queryClient,
  ]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const shareText = verse ? `${verse.reference}\n${verse.translation}\n\n${verse.text}` : "";

  async function handleCopy() {
    if (!verse) return;
    try {
      await copyText(shareText);
      trackEvent("verse_copied");
      toast("Copied");
    } catch {
      toast("Could not copy this verse");
    }
  }

  async function handleShare() {
    if (!verse) return;
    trackEvent("verse_shared");
    // Preferred: a rendered image card, shared through the system sheet or
    // downloaded where file sharing isn't supported.
    try {
      const blob = await createVerseImageBlob(verse);
      const file = new File([blob], verseImageFileName(verse), { type: "image/png" });
      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: verse.reference, text: shareText });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(url);
      toast("Image downloaded");
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      // Fall through to text sharing below.
    }
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: verse.reference, text: shareText });
      } catch (error) {
        if ((error as Error).name !== "AbortError") toast("Could not share this verse");
      }
      return;
    }
    try {
      await copyText(shareText);
      toast("Copied to clipboard");
    } catch {
      toast("Sharing isn't available on this device");
    }
  }

  function handleListen() {
    if (!verse || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      toast("Listening isn't available on this device");
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${verse.reference}. ${verse.text}`);
    utterance.rate = Number.parseFloat(playbackSpeed) || 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    trackEvent("verse_listened");
    setSpeaking(true);
  }

  const providerError = verseQuery.error instanceof BibleServiceError ? verseQuery.error : null;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const errorMessage =
    providerError?.kind === "network"
      ? offline
        ? "You’re offline, and this verse isn’t saved on this device yet. Verses you’ve opened recently are available offline — reconnect to read this one."
        : "Verse Snap couldn’t reach the Bible. Check your connection and try again."
      : providerError?.kind === "translation"
        ? "That translation isn't available."
        : "That Bible reference doesn't look right.";
  const actionClass =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-1.5 py-2 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

  return (
    <AppShell>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-7">
        <Link
          to="/search"
          className="flex min-w-0 items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden /> Search
        </Link>
        <Select
          value={params.translation}
          onValueChange={(value) =>
            navigate({
              to: "/verse/$translation/$book/$chapter/$verse",
              params: { ...params, translation: value },
            })
          }
        >
          <SelectTrigger
            className="h-8 w-auto gap-1.5 border-border text-[0.8125rem]"
            aria-label="Translation"
          >
            <SelectValue>{params.translation}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(translations ?? BIBLE_TRANSLATIONS).map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.code} · {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <article className="mt-10">
        <h1 className="font-serif text-2xl font-semibold">
          {ref.bookName} {ref.chapter}:{ref.verse}
        </h1>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {verse?.translation ?? params.translation} ·{" "}
          {translationName(verse?.translation ?? params.translation)}
        </p>
        {verseQuery.isLoading ? (
          <p className="mt-5 text-[0.9375rem] text-muted-foreground">Finding verse…</p>
        ) : verse ? (
          <p className="scripture mt-7">{verse.text}</p>
        ) : (
          <div className="mt-5">
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{errorMessage}</p>
            {verseQuery.isError ? (
              <Button variant="outline" className="mt-4" onClick={() => verseQuery.refetch()}>
                Try again
              </Button>
            ) : null}
          </div>
        )}
      </article>

      <div className="mt-8 flex border-y border-border">
        <Button
          type="button"
          variant="ghost"
          className={`${actionClass} h-auto rounded-none`}
          onClick={handleListen}
          disabled={!verse}
        >
          {speaking ? (
            <Square className="h-[1.125rem] w-[1.125rem]" aria-hidden />
          ) : (
            <Volume2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          )}
          {speaking ? "Stop" : "Listen"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`${actionClass} h-auto rounded-none`}
          onClick={() => toggleSave.mutate()}
          disabled={!verse || toggleSave.isPending}
        >
          {saved ? (
            <BookmarkCheck
              className="h-[1.125rem] w-[1.125rem] text-primary"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : (
            <Bookmark className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`${actionClass} h-auto rounded-none`}
          onClick={handleCopy}
          disabled={!verse}
        >
          <Copy className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          Copy
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`${actionClass} h-auto rounded-none`}
          onClick={handleShare}
          disabled={!verse}
        >
          <Share2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} aria-hidden />
          Share
        </Button>
      </div>

      <nav className="mt-6 flex items-center justify-between text-[0.875rem]">
        {neighbours?.previous ? (
          <Link
            to="/verse/$translation/$book/$chapter/$verse"
            params={{
              translation: params.translation,
              book: neighbours.previous.bookId,
              chapter: String(neighbours.previous.chapter),
              verse: String(neighbours.previous.verse),
            }}
            className="flex items-center gap-1 text-primary"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground/60">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </span>
        )}
        {neighbours?.next ? (
          <Link
            to="/verse/$translation/$book/$chapter/$verse"
            params={{
              translation: params.translation,
              book: neighbours.next.bookId,
              chapter: String(neighbours.next.chapter),
              verse: String(neighbours.next.verse),
            }}
            className="flex items-center gap-1 text-primary"
          >
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground/60">
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </nav>
    </AppShell>
  );
}
