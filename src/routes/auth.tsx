import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthForm } from "@/components/auth-form";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Verse Snap" },
      { name: "description", content: "Sign in to save verses and keep your reading history in sync." },
      { property: "og:title", content: "Sign in — Verse Snap" },
      { property: "og:description", content: "Save verses and keep your reading history in sync." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

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
      navigate({ to: "/", replace: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast("Google sign-in did not complete");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/", replace: true });
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center px-6 py-12">
      <Link to="/" className="text-[0.8125rem] text-muted-foreground hover:text-foreground">
        Back to Verse Snap
      </Link>

      {checkEmail ? (
        <div className="mt-8">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
            We sent a confirmation link to {email}. Open it to finish creating your account, then come
            back and sign in.
          </p>
        </div>
      ) : (
        <>
          <h1 className="mt-8 font-serif text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in" : "Create an account"}
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
            Save verses and keep your history on every device.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
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

          <div className="my-5 flex items-center gap-3 text-[0.75rem] uppercase tracking-[0.09em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full border-border bg-transparent"
            onClick={handleGoogle}
          >
            Continue with Google
          </Button>

          <div className="mt-7 space-y-2 text-[0.875rem]">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create an account" : "I already have an account"}
            </button>
            {mode === "signin" ? (
              <div>
                <button type="button" className="text-muted-foreground hover:underline" onClick={handleReset}>
                  Forgot your password?
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
