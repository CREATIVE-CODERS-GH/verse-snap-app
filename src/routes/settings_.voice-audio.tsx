import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChoiceSheet } from "@/components/reflection-parts";
import {
  OptionCard,
  SectionLabel,
  Segmented,
  SettingsCard,
  SubScreenHeader,
  SwitchRow,
} from "@/components/settings-parts";
import {
  ChevronRightIcon,
  MicIcon,
  PlayIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import { usePreferences, type MicSensitivity, type Narrator } from "@/lib/preferences";
import { PLAYBACK_SPEEDS, SPEECH_LANGUAGES } from "@/lib/preferences-storage";
import { useSpeak } from "@/lib/use-speak";

/*
 * Voice & Audio — Stitch "18 Voice & Audio Settings". Voice input settings feed Say a Verse;
 * narrator and speed feed every Listen button. Read-aloud uses the device's own voice, so narrator
 * styles adjust its pitch and pace rather than switching to a recorded narrator.
 */

export const Route = createFileRoute("/settings_/voice-audio")({
  head: () => ({
    meta: [{ title: "Voice & Audio — Verse Snap" }],
  }),
  component: VoiceAudioPage,
});

const NARRATORS: readonly { id: Narrator; title: string; subtitle: string; badge: string }[] = [
  {
    id: "classic",
    title: "Classic Resonant",
    subtitle: "Rich, measured cadence with historical solemnity",
    badge: "Deeper",
  },
  {
    id: "gentle",
    title: "Gentle Reading",
    subtitle: "Warm, intimate narration suited for contemplation",
    badge: "Lighter",
  },
  {
    id: "peaceful",
    title: "Peaceful Ambient",
    subtitle: "Soft, unhurried narration for quiet listening",
    badge: "Slower",
  },
];

const SENSITIVITY: readonly { value: MicSensitivity; label: string }[] = [
  { value: "quiet", label: "Quiet" },
  { value: "standard", label: "Standard" },
  { value: "open", label: "Open air" },
];

const SAMPLE_REF = { bookId: "psalms", bookName: "Psalm", chapter: 23, verse: 1 };

function speedLabel(speed: string): string {
  return speed === "1x" ? "1.0× (Normal)" : speed.replace("x", "×");
}

function VoiceAudioPage() {
  const navigate = useNavigate();
  const prefs = usePreferences();
  const [languageOpen, setLanguageOpen] = useState(false);
  const speech = useSpeak((message) => toast(message));
  const narrator = NARRATORS.find((item) => item.id === prefs.narrator) ?? NARRATORS[0]!;
  const language =
    SPEECH_LANGUAGES.find((item) => item.code === prefs.speechLanguage) ?? SPEECH_LANGUAGES[0]!;

  const sample = useQuery({
    queryKey: ["verse", prefs.translation, "psalms", "23", "1"],
    queryFn: () => bibleService.getVerse(SAMPLE_REF, prefs.translation),
    enabled: prefs.ready,
    retry: 1,
  });
  const sampleText = sample.data?.text ?? "The LORD is my shepherd; I shall not want.";

  return (
    <div className="min-h-dvh bg-brand-canvas font-stitch text-brand-text">
      <div className="mx-auto w-full max-w-[30rem] px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <SubScreenHeader
          title="Voice & Audio Settings"
          onBack={() => navigate({ to: "/settings" })}
        />

        <SettingsCard className="mt-2 flex items-center gap-3.5">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-primary-soft text-brand-primary"
            aria-hidden
          >
            <VolumeIcon className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-brand-text">Sacred Sound &amp; Voice</h2>
            <p className="text-[12.5px] leading-snug text-brand-text-muted">
              Calibrate speech recognition and peaceful scripture readings
            </p>
          </div>
        </SettingsCard>

        <SectionLabel aside="Say a Verse">Voice input</SectionLabel>
        <SettingsCard className="space-y-5">
          <SwitchRow
            label="Auto-listen on launch"
            hint="Start listening immediately when opening Say a Verse"
            checked={prefs.autoListen}
            onChange={(autoListen) => prefs.update({ autoListen })}
          />
          <button
            type="button"
            onClick={() => setLanguageOpen(true)}
            aria-haspopup="dialog"
            className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            <span>
              <span className="block text-[15px] font-semibold text-brand-text">
                Speech recognition language
              </span>
              <span className="mt-0.5 block text-[12.5px] text-brand-text-muted">
                Localized natural accents &amp; books
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[13.5px] text-brand-text-muted">
              {language.label}
              <ChevronRightIcon className="h-4 w-4" aria-hidden />
            </span>
          </button>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[15px] font-semibold text-brand-text">
                <MicIcon className="h-4 w-4 text-brand-text-muted" aria-hidden />
                Microphone sensitivity
              </span>
              <span className="rounded-full bg-brand-surface-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-brand-text-muted">
                {SENSITIVITY.find((item) => item.value === prefs.micSensitivity)?.label}
              </span>
            </div>
            <Segmented
              label="Microphone sensitivity"
              options={SENSITIVITY}
              value={prefs.micSensitivity}
              onChange={(micSensitivity) => prefs.update({ micSensitivity })}
            />
            <p className="mt-1.5 text-[11px] text-brand-text-faint">
              Saved for later: browsers currently manage microphone levels themselves.
            </p>
          </div>
        </SettingsCard>

        <SectionLabel aside="Narrator">Audio scripture playback</SectionLabel>
        <div role="radiogroup" aria-label="Narrator" className="space-y-2.5">
          {NARRATORS.map((item) => (
            <OptionCard
              key={item.id}
              selected={prefs.narrator === item.id}
              onSelect={() => prefs.update({ narrator: item.id })}
              title={item.title}
              subtitle={item.subtitle}
              badge={item.badge}
              preview={
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-surface-muted text-brand-text-muted"
                  aria-hidden
                >
                  <VolumeIcon className="h-5 w-5" />
                </span>
              }
            />
          ))}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-brand-text-faint">
          Uses your device’s voice, adjusted in pitch and pace.
        </p>

        <SectionLabel aside={speedLabel(prefs.playbackSpeed)}>Playback speed</SectionLabel>
        <Segmented
          label="Playback speed"
          options={PLAYBACK_SPEEDS.map((value) => ({
            value,
            label: value === "1x" ? "1.0x" : value,
          }))}
          value={prefs.playbackSpeed}
          onChange={(value) => prefs.setPlaybackSpeed(value)}
        />

        <SectionLabel aside="Psalm 23:1">Sample preview</SectionLabel>
        <SettingsCard className="text-center">
          <p className="font-display text-xl italic leading-relaxed text-brand-text">
            “{sampleText}”
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-brand-gold-text">
            Psalm 23:1 • {narrator.title}
          </p>
          <button
            type="button"
            onClick={() => speech.toggle(`Psalm 23, verse 1. ${sampleText}`)}
            aria-pressed={speech.speaking}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary py-3.5 text-[15px] font-semibold text-brand-on-primary shadow-md transition-colors hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-surface"
          >
            {speech.speaking ? (
              <>
                <StopSquareIcon className="h-5 w-5" /> Stop Sample
              </>
            ) : (
              <>
                <PlayIcon className="h-5 w-5" /> Play Voice Sample
              </>
            )}
          </button>
        </SettingsCard>

        <p className="mt-5 text-center text-[11.5px] text-brand-text-faint">
          Settings are saved on this device.
        </p>
      </div>

      <ChoiceSheet
        open={languageOpen}
        onOpenChange={setLanguageOpen}
        title="Speech recognition language"
        description="Used by Say a Verse"
        name="speech-language"
        options={SPEECH_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
        value={prefs.speechLanguage}
        onChange={(speechLanguage) => {
          prefs.update({ speechLanguage });
          setLanguageOpen(false);
        }}
      />
    </div>
  );
}
