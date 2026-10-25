import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  OptionCard,
  SectionLabel,
  Segmented,
  SettingsCard,
  SubScreenHeader,
} from "@/components/settings-parts";
import { InfoIcon, ListBulletIcon, RefreshIcon } from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import { translationName } from "@/lib/bible/translations";
import { usePreferences, type TextSize } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * Text Size — Stitch "17 Text Size Settings". Every control changes the saved preference at once,
 * and the live preview uses the same scripture styles as the reader, so what you see is what you get.
 */

export const Route = createFileRoute("/settings_/text-size")({
  head: () => ({
    meta: [{ title: "Text Size — Verse Snap" }],
  }),
  component: TextSizePage,
});

const SIZES: readonly {
  value: TextSize;
  label: string;
  hint: string;
  percent: number;
  aria: string;
}[] = [
  { value: "small", label: "A-", hint: "Small", percent: 85, aria: "Small" },
  { value: "medium", label: "A", hint: "Medium", percent: 100, aria: "Medium" },
  { value: "large", label: "A+", hint: "Large", percent: 115, aria: "Large" },
  { value: "xlarge", label: "A++", hint: "X-Large", percent: 130, aria: "Extra large" },
];

const PREVIEW_REF = { bookId: "romans", bookName: "Romans", chapter: 12, verse: 2 };

function TextSizePage() {
  const navigate = useNavigate();
  const prefs = usePreferences();
  const size = SIZES.find((item) => item.value === prefs.textSize) ?? SIZES[1]!;

  const preview = useQuery({
    queryKey: ["verse", prefs.translation, "romans", "12", "2"],
    queryFn: () => bibleService.getVerse(PREVIEW_REF, prefs.translation),
    enabled: prefs.ready,
    retry: 1,
  });

  return (
    <div className="min-h-dvh bg-brand-canvas font-stitch text-brand-text">
      <div className="mx-auto w-full max-w-[30rem] px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <SubScreenHeader title="Text Size" onBack={() => navigate({ to: "/settings" })} />

        <SectionLabel aside="Instant update">Live preview</SectionLabel>
        <SettingsCard>
          <div className="mb-3 flex items-center justify-between">
            <span className="rounded-full bg-brand-primary-soft px-2.5 py-0.5 text-[12px] font-semibold text-brand-primary">
              Romans 12:2
            </span>
            <span className="text-[11px] font-semibold tracking-wider text-brand-text-muted">
              {prefs.translation}
            </span>
          </div>
          <p className="scripture-focus text-brand-text" aria-live="polite">
            {preview.data
              ? `“${preview.data.text}”`
              : preview.isError
                ? "“Do not be conformed to this world, but be transformed by the renewing of your mind.”"
                : "Loading verse…"}
          </p>
          <div className="mt-3 flex items-center justify-between text-[11.5px]">
            <span className="text-brand-gold-text">{translationName(prefs.translation)}</span>
            <span className="text-brand-text-muted">• Devotional Display</span>
          </div>
        </SettingsCard>

        <SettingsCard className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="font-display text-base font-bold" aria-hidden>
                T<span className="text-xs">T</span>
              </span>
              Verse Text Size
            </h2>
            <span className="rounded-full bg-brand-primary-soft px-2.5 py-0.5 text-[12px] font-semibold text-brand-primary">
              {size.hint} ({size.percent}%)
            </span>
          </div>
          <Segmented
            label="Verse text size"
            options={SIZES}
            value={prefs.textSize}
            onChange={(value) => prefs.setTextSize(value)}
          />
          <div className="mt-2 flex justify-between px-1 text-[11px] text-brand-text-muted">
            <span>Compact</span>
            <span>Expanded Reader</span>
          </div>
        </SettingsCard>

        <SettingsCard className="mt-4">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
            <span
              className="flex h-5 w-5 items-center justify-center rounded border border-brand-text-muted font-display text-[11px] font-bold"
              aria-hidden
            >
              A
            </span>
            Reading Typeface
          </h2>
          <div role="radiogroup" aria-label="Reading typeface" className="grid grid-cols-2 gap-2.5">
            {(
              [
                {
                  id: "serif",
                  name: "Playfair Display",
                  note: "Editorial Serif",
                  font: "font-display italic",
                },
                { id: "sans", name: "Inter", note: "Modern Sans", font: "font-stitch" },
              ] as const
            ).map((face) => {
              const active = prefs.typeface === face.id;
              return (
                <button
                  key={face.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => prefs.update({ typeface: face.id })}
                  className={cn(
                    "flex flex-col rounded-2xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus",
                    active
                      ? "border-brand-primary bg-brand-primary-soft"
                      : "border-brand-border bg-brand-surface hover:bg-brand-surface-muted",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-brand-text">{face.name}</span>
                    {active ? (
                      <span
                        className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-brand-primary"
                        aria-hidden
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11.5px] text-brand-text-muted">{face.note}</span>
                  <span className={cn("mt-2 text-[26px] leading-none text-brand-text", face.font)}>
                    Aa
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsCard>

        <SettingsCard className="mt-4">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
            <ListBulletIcon className="h-5 w-5 text-brand-text-muted" aria-hidden />
            Line Spacing
          </h2>
          <div role="radiogroup" aria-label="Line spacing" className="grid grid-cols-2 gap-2.5">
            <OptionCard
              selected={prefs.lineSpacing === "standard"}
              onSelect={() => prefs.update({ lineSpacing: "standard" })}
              title="Standard"
              subtitle="1.4× ratio"
            />
            <OptionCard
              selected={prefs.lineSpacing === "relaxed"}
              onSelect={() => prefs.update({ lineSpacing: "relaxed" })}
              title="Relaxed"
              subtitle="1.8× ratio"
            />
          </div>
        </SettingsCard>

        <section className="mt-4 flex gap-3 rounded-2xl bg-brand-surface-muted p-4">
          <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-text-muted" aria-hidden />
          <div>
            <h2 className="text-[14px] font-semibold text-brand-text">Meditation Tip</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-brand-text-muted">
              Larger serif styling paired with relaxed line height reduces eye strain during
              extended devotional reading and prayer hours.
            </p>
          </div>
        </section>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={prefs.resetReading}
            className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface px-5 py-2.5 text-[14px] font-semibold text-brand-text transition-colors hover:bg-brand-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            <RefreshIcon className="h-4 w-4" />
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}
