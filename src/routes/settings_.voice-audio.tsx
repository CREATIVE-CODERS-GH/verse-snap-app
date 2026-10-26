import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChoiceSheet } from "@/components/reflection-parts";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  CloudSyncIcon,
  GraphicEqIcon,
  NatureIcon,
  PlayIcon,
  RecordVoiceIcon,
  StopSquareIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { bibleService } from "@/lib/bible/service";
import { usePreferences, type MicSensitivity, type Narrator } from "@/lib/preferences";
import { useDeviceVoices } from "@/lib/narration/narration";
import { voiceLabel } from "@/lib/narration/voices";
import { PLAYBACK_SPEEDS, SPEECH_LANGUAGES } from "@/lib/preferences-storage";
import { useSpeak } from "@/lib/use-speak";
import { cn } from "@/lib/utils";

/*
 * Voice & Audio — Stitch "18 Voice & Audio Settings" (reworked). Voice input settings feed Say a
 * Verse; narrator and speed feed every Listen button. Read-aloud uses the device's own voice, so
 * narrator styles adjust its pitch and pace rather than switching to a recorded narrator.
 */

export const Route = createFileRoute("/settings_/voice-audio")({
  head: () => ({
    meta: [{ title: "Voice & Audio — Verse Snap" }],
  }),
  component: VoiceAudioPage,
});

const NARRATORS: readonly {
  id: Narrator;
  title: string;
  subtitle: string;
  badge: string;
  icon: ReactNode;
}[] = [
  {
    id: "classic",
    title: "Classic Resonant",
    subtitle: "A lower, measured delivery with historical solemnity",
    badge: "Deeper",
    icon: <VolumeIcon className="h-5 w-5" />,
  },
  {
    id: "gentle",
    title: "Gentle Reading",
    subtitle: "A brighter, slightly slower delivery suited for contemplation",
    badge: "Brighter",
    icon: <RecordVoiceIcon className="h-5 w-5" />,
  },
  {
    id: "peaceful",
    title: "Peaceful Reading",
    subtitle: "A slow, unhurried delivery for quiet reflection",
    badge: "Slower",
    icon: <NatureIcon className="h-5 w-5" />,
  },
];

const SENSITIVITY: readonly {
  value: MicSensitivity;
  label: string;
  status: string;
  hint: string;
}[] = [
  {
    value: "quiet",
    label: "Quiet",
    status: "Quiet sanctuary",
    hint: "Trusts the first match it hears. Best in a quiet room.",
  },
  {
    value: "standard",
    label: "Standard",
    status: "Standard",
    hint: "Balanced for most places.",
  },
  {
    value: "open",
    label: "Open air",
    status: "Open air",
    hint: "Considers more possible matches when it is noisy around you.",
  },
];

/** What the badge beside "Playback Speed" says for each speed. */
const SPEED_STATUS: Record<string, string> = {
  "0.75x": "0.75× (Reflective)",
  "1x": "1.0× (Normal)",
  "1.25x": "1.25× (Attentive)",
  "1.5x": "1.5× (Focused)",
};

const SAMPLE_REF = { bookId: "psalms", bookName: "Psalm", chapter: 23, verse: 1 };

const CARD =
  "rounded-2xl border border-brand-border bg-brand-surface shadow-[0_2px_8px_rgba(0,0,0,0.03)]";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2 focus-visible:ring-offset-brand-canvas";

function Section({
  title,
  aside,
  asideClass,
  children,
}: {
  title: string;
  aside: string;
  asideClass?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-brand-text-muted">
          {title}
        </h2>
        <span
          className={cn(
            "text-[11px] font-medium uppercase tracking-wide text-brand-gold-text",
            asideClass,
          )}
        >
          {aside}
        </span>
      </div>
      {children}
    </section>
  );
}

/** The green switch with a check in its thumb. */
function CheckSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors duration-200",
        FOCUS,
        checked ? "bg-brand-primary" : "bg-brand-surface-strong",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full bg-brand-on-primary shadow-sm transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      >
        {checked ? (
          <CheckIcon className="h-[13px] w-[13px] text-brand-primary" strokeWidth={3} />
        ) : null}
      </span>
    </button>
  );
}

function VoiceAudioPage() {
  const navigate = useNavigate();
  const prefs = usePreferences();
  const [languageOpen, setLanguageOpen] = useState(false);
  const speech = useSpeak((message) => toast(message));
  const voices = useDeviceVoices();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const chosenVoice = voices.find((item) => item.uri === prefs.voiceURI);
  const narrator = NARRATORS.find((item) => item.id === prefs.narrator) ?? NARRATORS[0]!;
  const language =
    SPEECH_LANGUAGES.find((item) => item.code === prefs.speechLanguage) ?? SPEECH_LANGUAGES[0]!;
  const sensitivity =
    SENSITIVITY.find((item) => item.value === prefs.micSensitivity) ?? SENSITIVITY[1]!;

  const sample = useQuery({
    queryKey: ["verse", prefs.translation, "psalms", "23", "1"],
    queryFn: () => bibleService.getVerse(SAMPLE_REF, prefs.translation),
    enabled: prefs.ready,
    retry: 1,
  });
  const sampleText = sample.data?.text ?? "The LORD is my shepherd; I shall not want.";

  return (
    <div className="flex min-h-dvh flex-col bg-brand-canvas font-stitch text-brand-text antialiased">
      <header className="sticky top-0 z-50 border-b border-brand-border/60 bg-brand-canvas/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-4">
          <button
            type="button"
            aria-label="Back to Settings"
            onClick={() => navigate({ to: "/settings" })}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full text-brand-text transition-all hover:bg-brand-surface-muted active:scale-95",
              FOCUS,
            )}
          >
            <ArrowLeftIcon className="h-6 w-6" />
          </button>
          <h1 className="flex-1 truncate px-2 text-center text-[17px] font-semibold tracking-tight text-brand-text">
            Voice &amp; Audio Settings
          </h1>
          <div className="w-10" aria-hidden />
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-5">
        <div className="flex flex-col space-y-6">
          {/* Banner */}
          <div className={cn(CARD, "flex items-center gap-3.5 p-4")}>
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary-soft text-brand-primary"
              aria-hidden
            >
              <GraphicEqIcon className="h-6 w-6" />
            </span>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-[15px] font-semibold leading-tight text-brand-text">
                Sacred Sound &amp; Voice
              </h2>
              <p className="mt-0.5 text-[13px] leading-snug text-brand-text-muted">
                Calibrate speech recognition and peaceful scripture readings
              </p>
            </div>
          </div>

          {/* Voice input */}
          <Section title="Voice Input" aside="Say a Verse">
            <div className={cn(CARD, "divide-y divide-brand-border/70 overflow-hidden")}>
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 flex-col pr-1">
                  <span className="text-[15px] font-semibold leading-snug text-brand-text">
                    Auto-listen on launch
                  </span>
                  <span className="mt-0.5 text-[13px] leading-normal text-brand-text-muted">
                    Start listening immediately when opening Voice Search
                  </span>
                </div>
                <CheckSwitch
                  label="Auto-listen on launch"
                  checked={prefs.autoListen}
                  onChange={(autoListen) => prefs.update({ autoListen })}
                />
              </div>

              <button
                type="button"
                onClick={() => setLanguageOpen(true)}
                aria-haspopup="dialog"
                className={cn(
                  "flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-brand-surface-muted/60 active:bg-brand-surface-muted",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-focus",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-semibold leading-snug text-brand-text">
                    Speech language
                  </span>
                  <span className="mt-0.5 text-[13px] leading-normal text-brand-text-muted">
                    Used by Say a Verse, dictation and the read-aloud accent
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[14px] font-medium text-brand-text">{language.label}</span>
                  <ChevronRightIcon className="h-5 w-5 text-brand-text-muted" aria-hidden />
                </div>
              </button>

              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-brand-text">
                    Microphone sensitivity
                  </span>
                  <span className="rounded-full bg-brand-primary-soft px-2.5 py-0.5 text-[12px] font-medium text-brand-primary">
                    {sensitivity.status}
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Microphone sensitivity"
                  className="grid select-none grid-cols-3 gap-1 rounded-xl bg-brand-surface-muted p-1 text-center"
                >
                  {SENSITIVITY.map((item) => {
                    const on = item.value === prefs.micSensitivity;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => prefs.update({ micSensitivity: item.value })}
                        className={cn(
                          "rounded-lg px-1 py-2 text-[13px] transition-all",
                          FOCUS,
                          on
                            ? "bg-brand-surface font-semibold text-brand-primary shadow-sm"
                            : "font-medium text-brand-text-muted",
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[12px] leading-snug text-brand-text-muted">{sensitivity.hint}</p>
              </div>
            </div>
          </Section>

          {/* Narrator */}
          <Section title="Audio Scripture Playback" aside="Narrator">
            <div role="radiogroup" aria-label="Narrator" className="space-y-2.5">
              {NARRATORS.map((item) => {
                const on = prefs.narrator === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => prefs.update({ narrator: item.id })}
                    className={cn(
                      "flex w-full cursor-pointer items-start justify-between gap-3.5 rounded-2xl bg-brand-surface p-4 text-left transition-all",
                      FOCUS,
                      on
                        ? "border-2 border-brand-primary shadow-[0_2px_8px_rgba(31,95,74,0.06)]"
                        : "border border-brand-border shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-brand-text-faint",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                          on
                            ? "bg-brand-primary text-brand-on-primary shadow-sm"
                            : "border border-brand-border bg-brand-canvas text-brand-text-muted",
                        )}
                        aria-hidden
                      >
                        {item.icon}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold leading-snug text-brand-text">
                            {item.title}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              on
                                ? "bg-brand-primary-soft text-brand-primary"
                                : "bg-brand-surface-muted text-brand-text-muted",
                            )}
                          >
                            {item.badge}
                          </span>
                        </span>
                        <span className="mt-1 text-[13px] leading-snug text-brand-text-muted">
                          {item.subtitle}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                        on ? "border-brand-primary" : "border-brand-border",
                      )}
                      aria-hidden
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full",
                          on ? "bg-brand-primary" : "bg-transparent",
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setVoiceOpen(true)}
              aria-haspopup="dialog"
              className={cn(
                CARD,
                "mt-2.5 flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-brand-surface-muted/60",
                FOCUS,
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold leading-snug text-brand-text">
                  Device voice
                </span>
                <span className="mt-0.5 text-[13px] leading-normal text-brand-text-muted">
                  The voice this phone uses to read aloud
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="max-w-[9rem] truncate text-[14px] font-medium text-brand-text">
                  {chosenVoice ? chosenVoice.name : "Automatic"}
                </span>
                <ChevronRightIcon className="h-5 w-5 text-brand-text-muted" aria-hidden />
              </span>
            </button>
          </Section>

          {/* Speed */}
          <Section
            title="Playback Speed"
            aside={SPEED_STATUS[prefs.playbackSpeed] ?? "1.0× (Normal)"}
            asideClass="text-[12px] font-medium normal-case tracking-normal text-brand-primary"
          >
            <div className={cn(CARD, "p-2")}>
              <div
                role="radiogroup"
                aria-label="Playback speed"
                className="grid select-none grid-cols-4 gap-1.5 rounded-xl bg-brand-surface-muted p-1"
              >
                {PLAYBACK_SPEEDS.map((value) => {
                  const on = value === prefs.playbackSpeed;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => prefs.setPlaybackSpeed(value)}
                      className={cn(
                        "rounded-lg px-2 py-2.5 text-center text-[13px] transition-all",
                        FOCUS,
                        on
                          ? "bg-brand-primary font-semibold text-brand-on-primary shadow-sm"
                          : "font-medium text-brand-text",
                      )}
                    >
                      {value === "1x" ? "1.0x" : value}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          {/* Sample */}
          <Section title="Sample Preview" aside="Psalm 23:1">
            <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
              <div className="rounded-xl border border-brand-border bg-brand-canvas p-[1.125rem]">
                <p className="text-center font-display text-[18px] italic leading-relaxed text-brand-text">
                  “{sampleText}”
                </p>
                <div className="mt-2.5 flex items-center justify-center gap-1.5 text-center">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-brand-gold-text">
                    Psalm 23:1
                  </span>
                  <span className="text-[12px] text-brand-text-muted" aria-hidden>
                    •
                  </span>
                  <span className="text-[12px] text-brand-text-muted">{narrator.title}</span>
                </div>
              </div>

              {speech.speaking ? (
                <div
                  className="flex items-center justify-center gap-1.5 py-1"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="h-3 w-1 animate-pulse rounded-full bg-brand-primary"
                    aria-hidden
                  />
                  <span
                    className="h-6 w-1 animate-bounce rounded-full bg-brand-primary"
                    aria-hidden
                  />
                  <span
                    className="h-4 w-1 animate-pulse rounded-full bg-brand-primary"
                    aria-hidden
                  />
                  <span
                    className="h-7 w-1 animate-bounce rounded-full bg-brand-primary"
                    aria-hidden
                  />
                  <span
                    className="h-3 w-1 animate-pulse rounded-full bg-brand-primary"
                    aria-hidden
                  />
                  <span className="ml-2 text-[12px] font-medium text-brand-primary">
                    Playing voice sample...
                  </span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => speech.toggle(`Psalm 23, verse 1. ${sampleText}`)}
                aria-pressed={speech.speaking}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-4 py-3.5 text-[15px] font-medium text-brand-on-primary shadow-sm transition-all hover:bg-brand-primary-hover active:scale-[0.99]",
                  FOCUS,
                )}
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
            </div>
          </Section>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 pb-4 pt-1 text-center">
            <CloudSyncIcon className="h-4 w-4 text-brand-gold-text" aria-hidden />
            <span className="text-[12px] text-brand-text-muted">
              Settings are saved on this device.
            </span>
          </div>
        </div>
      </main>

      <ChoiceSheet
        open={languageOpen}
        onOpenChange={setLanguageOpen}
        title="Speech language"
        description="Used by Say a Verse, dictation and the read-aloud accent"
        name="speech-language"
        options={SPEECH_LANGUAGES.map((item) => ({ id: item.code, label: item.label }))}
        value={prefs.speechLanguage}
        onChange={(speechLanguage) => {
          prefs.update({ speechLanguage });
          setLanguageOpen(false);
        }}
      />
      <ChoiceSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        title="Device voice"
        description={
          voices.length > 0
            ? "Voices installed on this device. They differ by phone and browser."
            : "This device offers no choice of voices, so its default voice is used."
        }
        name="device-voice"
        options={[
          { id: "", label: "Automatic" },
          ...voices.map((item) => ({ id: item.uri, label: voiceLabel(item) })),
        ]}
        value={chosenVoice ? prefs.voiceURI : ""}
        onChange={(voiceURI) => {
          prefs.update({ voiceURI });
          setVoiceOpen(false);
        }}
      />
    </div>
  );
}
