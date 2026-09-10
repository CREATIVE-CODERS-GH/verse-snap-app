import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthForm } from "@/components/auth-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bibleService } from "@/lib/bible/service";
import { useAuth } from "@/lib/auth";
import { usePreferences, type TextSize, type Theme } from "@/lib/preferences";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Verse Snap" },
      { name: "description", content: "Choose your translation, text size, theme and account options." },
      { property: "og:title", content: "Settings — Verse Snap" },
      { property: "og:description", content: "Translation, text size, theme and account options." },
    ],
  }),
  component: SettingsPage,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-1 border-t border-border">{children}</div>
    </section>
  );
}

function Row({
  label,
  note,
  control,
}: {
  label: string;
  note?: string | undefined;
  control: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3.5">
      <div className="min-w-0">
        <p className="truncate text-[0.9375rem]">{label}</p>
        {note ? <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">{note}</p> : null}
      </div>
      {control}
    </div>
  );
}

function SettingsPage() {
  const prefs = usePreferences();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: translations } = useQuery({
    queryKey: ["translations"],
    queryFn: () => bibleService.listTranslations(),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const selectClass = "h-9 w-auto min-w-[7rem] border-border text-[0.875rem]";

  return (
    <AppShell title="Settings">
      <Section title="Bible">
        <Row
          label="Translation"
          control={
            <Select value={prefs.translation} onValueChange={prefs.setTranslation}>
              <SelectTrigger className={selectClass} aria-label="Translation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(translations ?? [{ code: "KJAV", name: "King James (Authorized) Version", language: "English" }]).map(
                  (item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.code}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          }
        />
        <Row
          label="Text Size"
          control={
            <Select
              value={prefs.textSize}
              onValueChange={(value) => prefs.setTextSize(value as TextSize)}
            >
              <SelectTrigger className={selectClass} aria-label="Text size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
                <SelectItem value="xlarge">Extra large</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </Section>

      <Section title="Appearance">
        <Row
          label="Theme"
          control={
            <Select value={prefs.theme} onValueChange={(value) => prefs.setTheme(value as Theme)}>
              <SelectTrigger className={selectClass} aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </Section>

      <Section title="Audio">
        <Row
          label="Playback Speed"
          note="Used when listening to a verse"
          control={
            <Select value={prefs.playbackSpeed} onValueChange={prefs.setPlaybackSpeed}>
              <SelectTrigger className={selectClass} aria-label="Playback speed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.75x">0.75x</SelectItem>
                <SelectItem value="1x">1x</SelectItem>
                <SelectItem value="1.25x">1.25x</SelectItem>
                <SelectItem value="1.5x">1.5x</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </Section>

      <Section title="Account">
        {loading ? (
          <div className="border-b border-border py-3.5 text-[0.875rem] text-muted-foreground">
            Checking your account…
          </div>
        ) : user ? (
          <>
            <Row label="Signed in" note={user.email ?? undefined} control={<span />} />
            <Row
              label="Saved & History"
              note="Private to this account and synced across your devices"
              control={<span />}
            />
            <div className="border-b border-border py-3.5">
              <button
                type="button"
                onClick={handleSignOut}
                className="text-[0.9375rem] text-destructive"
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <div className="border-b border-border">
            <AuthForm idPrefix="settings" onSignedIn={() => navigate({ to: "/saved" })} />
          </div>
        )}
      </Section>

      <Section title="About">
        <Row label="About Verse Snap" note="Version 1.0" control={<span />} />
        <Row label="Privacy Policy" note="Coming soon" control={<span />} />
        <Row label="Terms of Service" note="Coming soon" control={<span />} />
      </Section>
    </AppShell>
  );
}
