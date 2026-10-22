import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { SheetFrame } from "@/components/chapter-sheets";
import { ChoiceSheet } from "@/components/reflection-parts";
import { CrossRefAttribution } from "@/components/cross-reference-parts";
import { SettingsRow } from "@/components/settings-parts";
import {
  BookOpenIcon,
  ClockIcon,
  DatabaseIcon,
  DocumentIcon,
  InfoIcon,
  PaletteIcon,
  PersonIcon,
  ShieldIcon,
  VolumeIcon,
} from "@/components/stitch-icons";
import { TranslationSheet } from "@/components/translation-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { bibleService } from "@/lib/bible/service";
import { BIBLE_TRANSLATIONS } from "@/lib/bible/translations";
import { useAuth } from "@/lib/auth";
import { library } from "@/lib/library";
import { usePreferences, type Theme } from "@/lib/preferences";
import { supabase } from "@/integrations/supabase/client";

/*
 * Settings — Stitch "11 Settings": one list of rows. Text Size and Voice & Audio open their own
 * screens (Stitch 17 and 18); translation and appearance open sheets; the destructive rows ask first.
 */

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Verse Snap" },
      {
        name: "description",
        content: "Choose your translation, text size, theme and account options.",
      },
      { property: "og:title", content: "Settings — Verse Snap" },
      { property: "og:description", content: "Translation, text size, theme and account options." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const APP_VERSION = "v1.0.0";

const TEXT_SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large", xlarge: "X-Large" };
const THEME_OPTIONS: readonly { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

type Confirm = "history" | "cache" | "signout" | null;
type Info = "privacy" | "terms" | "about" | "account" | null;

function AaIcon() {
  return <span className="block w-5 text-center font-display text-[15px] font-semibold">AA</span>;
}

function SettingsPage() {
  const prefs = usePreferences();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [info, setInfo] = useState<Info>(null);

  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });

  const clearHistory = useMutation({
    mutationFn: () => library.clearHistory(user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
      toast("History cleared");
    },
    onError: () => toast("Could not clear history"),
  });

  // Removes Bible text kept for offline reading and the in-memory cache. Saved verses, history,
  // preferences and sign-in are not touched.
  const clearCache = () => {
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("versesnap.bible.")) window.localStorage.removeItem(key);
      }
    } catch {
      /* storage unavailable */
    }
    queryClient.removeQueries({ queryKey: ["chapter"] });
    queryClient.removeQueries({ queryKey: ["verse"] });
    toast("Cached Bible text cleared");
  };

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const accountValue = loading ? "…" : user ? (user.email ?? "Signed in") : "Sign in";

  return (
    <AppShell variant="stitch">
      <main className="flex flex-1 flex-col">
        <h1 className="pb-3 pt-6 text-3xl font-bold tracking-tight text-brand-text">Settings</h1>

        <ul>
          <SettingsRow
            icon={<BookOpenIcon className="h-5 w-5" />}
            label="Bible translation"
            value={prefs.translation}
            onClick={() => setTranslationsOpen(true)}
          />
          <SettingsRow
            icon={<AaIcon />}
            label="Text size"
            value={TEXT_SIZE_LABELS[prefs.textSize]}
            onClick={() => navigate({ to: "/settings/text-size" })}
          />
          <SettingsRow
            icon={<PaletteIcon className="h-5 w-5" />}
            label="Appearance"
            value={THEME_OPTIONS.find((item) => item.id === prefs.theme)?.label}
            onClick={() => setAppearanceOpen(true)}
          />
          <SettingsRow
            icon={<VolumeIcon className="h-5 w-5" />}
            label="Voice & audio"
            onClick={() => navigate({ to: "/settings/voice-audio" })}
          />
          <SettingsRow
            icon={<ClockIcon className="h-5 w-5" />}
            label="Clear history"
            onClick={() => setConfirm("history")}
          />
          <SettingsRow
            icon={<DatabaseIcon className="h-5 w-5" />}
            label="Clear cached data"
            onClick={() => setConfirm("cache")}
          />
        </ul>

        <div className="my-3 h-px bg-brand-border" />

        <ul>
          <SettingsRow
            icon={<PersonIcon className="h-5 w-5" />}
            label="Account"
            value={accountValue}
            onClick={() => (user ? setInfo("account") : navigate({ to: "/auth" }))}
          />
          <SettingsRow
            icon={<ShieldIcon className="h-5 w-5" />}
            label="Privacy"
            onClick={() => setInfo("privacy")}
          />
          <SettingsRow
            icon={<DocumentIcon className="h-5 w-5" />}
            label="Terms and conditions"
            onClick={() => setInfo("terms")}
          />
          <SettingsRow
            icon={<InfoIcon className="h-5 w-5" />}
            label="About Verse Snap"
            value={APP_VERSION}
            onClick={() => setInfo("about")}
          />
        </ul>
      </main>

      <TranslationSheet
        open={translationsOpen}
        onOpenChange={setTranslationsOpen}
        current={prefs.translation}
        options={translations ?? BIBLE_TRANSLATIONS}
        onConfirm={(code) => {
          prefs.setTranslation(code);
          setTranslationsOpen(false);
        }}
      />

      <ChoiceSheet
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        title="Appearance"
        description="System follows your device’s light or dark setting"
        name="appearance"
        options={THEME_OPTIONS}
        value={prefs.theme}
        onChange={(id) => {
          prefs.setTheme(id as Theme);
          setAppearanceOpen(false);
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? null : setConfirm(null))}
        title={
          confirm === "history"
            ? "Clear history?"
            : confirm === "cache"
              ? "Clear cached data?"
              : "Sign out?"
        }
        body={
          confirm === "history"
            ? "This removes every verse from your history. Saved verses are not affected."
            : confirm === "cache"
              ? "This removes Bible text kept for offline reading. Your saved verses, history and settings stay."
              : "You can sign back in at any time. Saved verses on this account stay in your account."
        }
        action={
          confirm === "history" ? "Clear history" : confirm === "cache" ? "Clear data" : "Sign out"
        }
        onConfirm={() => {
          if (confirm === "history") clearHistory.mutate();
          else if (confirm === "cache") clearCache();
          else if (confirm === "signout") void signOut();
          setConfirm(null);
        }}
      />

      <SheetFrame
        open={info !== null}
        onOpenChange={(open) => (open ? null : setInfo(null))}
        title={
          info === "account"
            ? "Account"
            : info === "privacy"
              ? "Privacy"
              : info === "terms"
                ? "Terms and conditions"
                : "About Verse Snap"
        }
      >
        <InfoBody
          info={info}
          email={user?.email ?? null}
          onSignOut={() => {
            setInfo(null);
            setConfirm("signout");
          }}
        />
      </SheetFrame>
    </AppShell>
  );
}

function InfoBody({
  info,
  email,
  onSignOut,
}: {
  info: Info;
  email: string | null;
  onSignOut: () => void;
}): ReactNode {
  const p = "text-[14.5px] leading-relaxed text-brand-text-muted";
  if (info === "account") {
    return (
      <div className="space-y-4 pb-2">
        <p className={p}>
          Signed in as <span className="font-semibold text-brand-text">{email}</span>. Your saved
          verses and history are private to this account and available on your other devices.
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full rounded-full border border-brand-border py-3 text-[15px] font-semibold text-brand-danger transition-colors hover:bg-brand-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
        >
          Sign out
        </button>
      </div>
    );
  }
  if (info === "privacy") {
    return (
      <div className="space-y-3 pb-2">
        <p className={p}>
          Your saved verses, history and reflections belong to you. Signed out, they stay on this
          device; signed in, they are private to your account.
        </p>
        <p className={p}>
          Microphone and camera are used only while you are looking up a verse, and the audio and
          photos are not stored. Anonymous usage counts help improve the app; search text is not
          included.
        </p>
        <p className="text-[12.5px] text-brand-text-faint">
          The full privacy policy is coming soon.
        </p>
      </div>
    );
  }
  if (info === "terms") {
    return (
      <div className="space-y-3 pb-2">
        <p className={p}>
          Verse Snap is a free tool for finding and reading Scripture. Bible text is provided by the
          publishers of each translation under their own terms.
        </p>
        <p className="text-[12.5px] text-brand-text-faint">
          The full terms and conditions are coming soon.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 pb-2 text-center">
      <img src="/icons/icon-192.png" alt="" className="mx-auto h-16 w-16 rounded-[22%]" />
      <p className="font-display text-xl font-semibold text-brand-text">Verse Snap</p>
      <p className={p}>Find your verse. Instantly.</p>
      <CrossRefAttribution className="text-left" />
      <p className="text-[12.5px] text-brand-text-faint">Version {APP_VERSION.slice(1)}</p>
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[22rem] rounded-2xl border-brand-border bg-brand-surface font-stitch text-brand-text">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="font-display text-lg">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-brand-text-muted">{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="rounded-full bg-brand-danger text-brand-on-danger hover:bg-brand-danger/90"
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
