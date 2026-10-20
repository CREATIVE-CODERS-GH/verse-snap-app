import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { lazy, useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { GuestMergePrompt } from "@/components/guest-merge-prompt";
import { OAuthReturnNotice } from "@/components/oauth-return-notice";
import { invalidateUserQueries, planAuthEvent } from "@/lib/auth-events";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth";
import { PreferencesProvider } from "@/lib/preferences";
import { registerServiceWorker } from "@/lib/pwa-register";
import { isConnectionError, NetworkErrorScreen, PILL_OUTLINE } from "@/components/search-states";

function NotFoundComponent() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-canvas px-6 font-stitch text-brand-text">
      <div className="max-w-md text-center">
        <p className="font-display text-7xl font-bold text-brand-text-faint">404</p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-text-muted">
          The page you’re looking for doesn’t exist or has been moved.
        </p>
        <Link to="/" className={`${PILL_OUTLINE} mt-6`}>
          Go home
        </Link>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const connection = isConnectionError(error);
  useEffect(() => {
    if (connection) return; // a lost connection is not a bug worth reporting
    reportLovableError(error instanceof Error ? error : new Error(String(error)), {
      boundary: "tanstack_root_error_component",
    });
  }, [error, connection]);

  const retry = () => {
    router.invalidate();
    reset?.();
  };

  // Stitch 16: a lost connection gets the Connection problem screen.
  if (connection) {
    return (
      <NetworkErrorScreen
        onRetry={retry}
        offline={typeof navigator !== "undefined" && navigator.onLine === false}
      />
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-canvas px-6 font-stitch text-brand-text">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">This page didn’t load</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-text-muted">
          Something went wrong on our end. You can try again or head back home.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <button type="button" onClick={retry} className={PILL_OUTLINE}>
            Try again
          </button>
          <a
            href="/"
            className="text-sm font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}

// Route error components are lazy-typed in TanStack Router v1.
const LazyErrorComponent = lazy(async () => ({ default: ErrorComponent }));

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Verse Snap — Find your verse. Instantly." },
      {
        name: "description",
        content: "A quiet, fast way to open and read any Bible verse.",
      },
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Verse Snap" },
      { property: "og:title", content: "Verse Snap — Find your verse. Instantly." },
      {
        property: "og:description",
        content: "A quiet, fast way to open and read any Bible verse.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap",
      },
      {
        // Stitch design system fonts (Playfair Display + Inter), used by rebuilt screens.
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: LazyErrorComponent,
});

// Applies the saved theme and text size before the first paint, so dark-mode readers never see a
// white flash while the app loads. Mirrors PreferencesProvider (same storage key and rules).
const THEME_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem("versesnap.preferences")||"{}");var t=p.theme==="light"||p.theme==="dark"?p.theme:"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");if(typeof p.textSize==="string")r.setAttribute("data-text-size",p.textSize);if(p.typeface==="sans")r.setAttribute("data-typeface","sans");if(p.lineSpacing==="standard")r.setAttribute("data-line-spacing","standard");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"#121212":"#ffffff");}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The boot script may add the "dark" class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // supabase-js repeats SIGNED_IN whenever a tab regains focus. Only real changes refresh data,
      // and paid AI search results are never invalidated (see src/lib/auth-events.ts).
      const plan = planAuthEvent(event, session?.user?.id ?? null, lastUserId.current);
      lastUserId.current = plan.userId;
      if (plan.invalidateRouter) router.invalidate();
      if (plan.invalidateQueries) void invalidateUserQueries(queryClient);
      if (event === "SIGNED_OUT") {
        // Account data is never kept on the device; also drop it from memory on sign-out.
        queryClient.removeQueries({ queryKey: ["saved"] });
        queryClient.removeQueries({ queryKey: ["history"] });
        queryClient.removeQueries({ queryKey: ["highlights"] });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return null;
}

// Vercel Web Analytics: anonymous page views. Query strings are dropped before sending, because
// search URLs carry the text people typed (see src/lib/analytics.ts: raw search text is never sent).
function withoutQuery<T extends { url: string }>(event: T): T {
  const url = new URL(event.url);
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
          <AuthSync />
          <OAuthReturnNotice />
          <GuestMergePrompt />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-center" />
          <Analytics beforeSend={withoutQuery} />
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
