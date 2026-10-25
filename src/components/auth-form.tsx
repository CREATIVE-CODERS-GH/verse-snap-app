import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { clearOAuthPending, markOAuthPending } from "@/lib/oauth-return";

export type AuthMode = "signin" | "signup";

const FIELD = "h-12 rounded-xl border-ch-outline/30 bg-ch-container-lowest";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.15z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
        fill="#34A853"
      />
      <path
        d="M5.28 14.27a7.17 7.17 0 010-4.54V6.58H1.25a11.97 11.97 0 000 10.84l4.03-3.15z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function AuthForm({
  idPrefix = "auth",
  mode,
  onModeChange,
  onSignedIn,
}: {
  idPrefix?: string;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSignedIn?: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const signup = mode === "signup";
  const mismatch = signup && confirm.length > 0 && confirm !== password;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (signup && password !== confirm) {
      toast("The two passwords don't match");
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name.trim() },
          },
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
      setConfirm("");
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
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ch-on-surface-variant">
          We sent a confirmation link to {email}. Open it to finish creating your account, then come
          back and sign in.
        </p>
        <button
          type="button"
          className="mt-3 text-[0.875rem] font-semibold text-ch-primary hover:underline"
          onClick={() => {
            setCheckEmail(false);
            onModeChange("signin");
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">
        {signup ? "Create your account" : "Welcome back"}
      </h2>
      <p className="mt-1 text-[0.875rem] leading-relaxed text-ch-on-surface-variant">
        {signup
          ? "Your saved verses and history stay private to your account."
          : "Sign in to pick up where you left off."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {signup ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-name`}>Name</Label>
            <Input
              id={`${idPrefix}-name`}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-password`}>Password</Label>
          <div className="relative">
            <Input
              id={`${idPrefix}-password`}
              type={showPassword ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`${FIELD} pr-16`}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 px-3.5 text-[0.75rem] font-semibold text-ch-primary"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {signup ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-confirm`}>Confirm password</Label>
            <Input
              id={`${idPrefix}-confirm`}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={6}
              aria-invalid={mismatch}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={FIELD}
            />
            {mismatch ? (
              <p role="alert" className="text-[0.75rem] text-ch-error">
                The two passwords don't match.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="text-right">
            <button
              type="button"
              className="text-[0.8125rem] text-ch-on-surface-variant hover:underline"
              onClick={handleReset}
            >
              Forgot your password?
            </button>
          </div>
        )}
        <Button
          type="submit"
          className="h-12 w-full rounded-full bg-ch-primary text-ch-on-primary hover:bg-ch-primary/90"
          disabled={busy}
        >
          {signup ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[0.75rem] uppercase tracking-[0.09em] text-ch-outline">
        <span className="h-px flex-1 bg-ch-outline/30" />
        or continue with
        <span className="h-px flex-1 bg-ch-outline/30" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-12 w-full gap-2 rounded-xl border-ch-outline/30 bg-ch-container-lowest"
        onClick={handleGoogle}
        disabled={googleBusy}
      >
        <GoogleMark />
        {googleBusy ? "Opening Google…" : "Continue with Google"}
      </Button>

      <p className="mt-6 text-center text-[0.875rem] text-ch-on-surface-variant">
        {signup ? "Already have an account?" : "New to Verse Snap?"}{" "}
        <button
          type="button"
          className="font-semibold text-ch-primary hover:underline"
          onClick={() => onModeChange(signup ? "signin" : "signup")}
        >
          {signup ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}
