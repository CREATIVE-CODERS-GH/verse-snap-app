import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — Verse Snap" },
      { name: "description", content: "Choose a new password for your Verse Snap account." },
      { property: "og:title", content: "Set a new password — Verse Snap" },
      { property: "og:description", content: "Choose a new password for your Verse Snap account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast(error.message);
      return;
    }
    toast("Password updated");
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center px-6 py-12">
      <h1 className="font-serif text-2xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        Choose a password you will remember.
      </p>
      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11"
          />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}
