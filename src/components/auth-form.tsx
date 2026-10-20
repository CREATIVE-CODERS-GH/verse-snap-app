import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { clearOAuthPending, markOAuthPending } from "@/lib/oauth-return";

export type AuthMode = "signin" | "signup";

export function AuthForm({
  idPrefix = "auth",
  onSignedIn,
}: {
  idPrefix?: string;
  onSignedIn?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setCheckEmail(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setPassword("");
      onSignedIn?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // Returning with the browser's Back button from Google restores this page from
  // the back/forward cache with the button still disabled; re-enable it.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) setGoogleBusy(false);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function handleGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    markOAuthPending();
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      // Success: the browser is now navigating to Google, so the button stays disabled.
      // A cancelled or rejected attempt is reported by OAuthReturnNotice on return.
    } catch {
      clearOAuthPending();
      setGoogleBusy(false);
      toast("Google sign-in did not complete. Please try again.");
    }
  }

  async function handleReset() {
    if (!email) {
      toast("Enter your email address first");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    toast(error ? "Could not send the reset email" : "Password reset email sent");
  }

  if (checkEmail) {
    return (
      <div className="py-4">
        <p className="text-[0.9375rem] font-medium">Check your email</p>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-muted-foreground">
          We sent a confirmation link to {email}. Open it to finish creating your account, then come
          back and sign in.
        </p>
        <button
          type="button"
          className="mt-3 text-[0.875rem] text-primary hover:underline"
          onClick={() => {
            setCheckEmail(false);
            setMode("signin");
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="py-4">
      <p className="text-[0.9375rem] font-medium">
        {mode === "signin" ? "Sign in" : "Create an account"}
      </p>
      <p className="mt-1 text-[0.875rem] text-muted-foreground">
        Your saved verses and history stay private to your account.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-password`}>Password</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11"
          />
        </div>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-[0.75rem] uppercase tracking-[0.09em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full border-border bg-transparent"
        onClick={handleGoogle}
        disabled={googleBusy}
      >
        {googleBusy ? "Opening Google…" : "Continue with Google"}
      </Button>

      <div className="mt-5 space-y-2 text-[0.875rem]">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create an account" : "I already have an account"}
        </button>
        {mode === "signin" ? (
          <div>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={handleReset}
            >
              Forgot your password?
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
