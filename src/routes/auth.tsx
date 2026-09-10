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

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center px-6 py-12">
      <Link to="/" className="text-[0.8125rem] text-muted-foreground hover:text-foreground">
        Back to Verse Snap
      </Link>
      <h1 className="mt-8 font-serif text-2xl font-semibold tracking-tight">Verse Snap</h1>
      <AuthForm idPrefix="auth" onSignedIn={() => navigate({ to: "/", replace: true })} />
    </div>
  );
}
