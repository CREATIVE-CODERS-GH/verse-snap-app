import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand-mark";
import { AuthForm, type AuthMode } from "@/components/auth-form";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode?: AuthMode } =>
    search["mode"] === "signup" ? { mode: "signup" } : {},
  head: () => ({
    meta: [
      { title: "Sign in — Verse Snap" },
      {
        name: "description",
        content: "Sign in to save verses and keep your reading history in sync.",
      },
      { property: "og:title", content: "Sign in — Verse Snap" },
      { property: "og:description", content: "Save verses and keep your reading history in sync." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const mode: AuthMode = Route.useSearch().mode ?? "signin";

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  return (
    <div className="flex min-h-dvh flex-col bg-ch-surface font-stitch text-ch-on-surface">
      <header className="rounded-br-[4.5rem] bg-ch-primary px-6 pb-10 pt-[calc(2rem+env(safe-area-inset-top))] text-ch-on-primary">
        <div className="mx-auto w-full max-w-[26rem]">
          <Link to="/" className="text-[0.8125rem] opacity-80 hover:opacity-100">
            Back to Verse Snap
          </Link>
          <div className="mt-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="font-serif text-3xl font-bold tracking-tight">Verse Snap</h1>
              <p className="mt-1 text-[0.8125rem] opacity-80">Find your verse. Instantly.</p>
            </div>
            <BrandMark large className="h-20 w-20 rounded-full ring-2 ring-ch-on-primary/40" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[26rem] flex-1 px-6 pb-12 pt-8">
        <AuthForm
          idPrefix="auth"
          mode={mode}
          onModeChange={(next) =>
            navigate({
              to: "/auth",
              search: next === "signup" ? { mode: "signup" } : {},
              replace: true,
            })
          }
          onSignedIn={() => navigate({ to: "/", replace: true })}
        />
      </main>
    </div>
  );
}
