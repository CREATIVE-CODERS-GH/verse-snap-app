import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Home action card from the approved Stitch design ("04 — Home Screen"). */
export type ActionTone = "voice" | "camera" | "search";

// Full class names so Tailwind can see them; each tone maps to --vs-<tone>-* tokens in styles.css.
const TONES: Record<
  ActionTone,
  { card: string; glow: string; icon: string; heading: string; text: string }
> = {
  voice: {
    card: "from-vs-voice-from to-vs-voice-to",
    glow: "bg-vs-voice-glow",
    icon: "from-vs-voice-icon-from to-vs-voice-icon-to shadow-vs-voice-shadow",
    heading: "text-vs-voice-heading",
    text: "text-vs-voice-text",
  },
  camera: {
    card: "from-vs-camera-from to-vs-camera-to",
    glow: "bg-vs-camera-glow",
    icon: "from-vs-camera-icon-from to-vs-camera-icon-to shadow-vs-camera-shadow",
    heading: "text-vs-camera-heading",
    text: "text-vs-camera-text",
  },
  search: {
    card: "from-vs-search-from to-vs-search-to",
    glow: "bg-vs-search-glow",
    icon: "from-vs-search-icon-from to-vs-search-icon-to shadow-vs-search-shadow",
    heading: "text-vs-search-heading",
    text: "text-vs-search-text",
  },
};

interface ActionCardProps {
  to: "/voice" | "/scan" | "/search";
  tone: ActionTone;
  icon: ReactNode;
  title: string;
  description: string;
}

export function ActionCard({ to, tone, icon, title, description }: ActionCardProps) {
  const styles = TONES[tone];
  return (
    <Link
      to={to}
      className={`relative flex min-h-40 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-vs-card-border bg-gradient-to-b p-4 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] ${styles.card}`}
    >
      <span
        className={`pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-xl ${styles.glow}`}
        aria-hidden
      />
      <span
        className={`relative mb-2.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-md ring-4 ring-vs-ring ${styles.icon}`}
        aria-hidden
      >
        {icon}
      </span>
      <span
        className={`font-display text-lg font-semibold leading-snug tracking-tight ${styles.heading}`}
      >
        {title}
      </span>
      <span className={`mt-1 text-xs font-normal ${styles.text}`}>{description}</span>
    </Link>
  );
}
