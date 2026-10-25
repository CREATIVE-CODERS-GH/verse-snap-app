import type { SVGProps } from "react";

/**
 * Icons taken from the approved Stitch designs (Heroicons outline paths, MIT licence, plus the filled
 * "active" variants Stitch draws for the tab bar). Inline SVG: no dependency, inherits currentColor.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { strokeWidth?: number };

function Outline({
  strokeWidth = 1.8,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" />
    </Outline>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </Outline>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props}>
      <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </Outline>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </Outline>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.6 6.6 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.216.456a1.125 1.125 0 01-1.37-.49l-1.296-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </Outline>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </Outline>
  );
}

/** Outline bookmark, or the filled form Stitch uses when the Saved tab is active. */
export function BookmarkIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
        <path d="M5 4a2 2 0 012-2h10a2 2 0 012 2v18l-7-4.5L5 22V4z" />
      </svg>
    );
  }
  return (
    <Outline {...props}>
      <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </Outline>
  );
}

/** Outline house, or the filled form Stitch draws for the active Home tab. */
export function HomeIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
      </svg>
    );
  }
  return (
    <Outline {...props}>
      <path d="M3 10.5L12 3l9 7.5v10a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5h-4v5a1 1 0 01-1 1H4a1 1 0 01-1-1v-10z" />
    </Outline>
  );
}

// --- Search screens (05 / 19 and the loading and error patterns) ---

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </Outline>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.5} {...props}>
      <path d="M6 18L18 6M6 6l12 12" />
    </Outline>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </Outline>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </Outline>
  );
}

export function DropletIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 3s6.25 6.3 6.25 10.75a6.25 6.25 0 11-12.5 0C5.75 9.3 12 3 12 3z" />
    </Outline>
  );
}

/** A sprouting leaf, used for "renewing your mind". */
export function SproutIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 21v-8m0 0c0-3.5-2.5-6-6.5-6 0 3.9 2.6 6 6.5 6zm0 0c0-3.5 2.5-6 6.5-6 0 3.9-2.6 6-6.5 6z" />
    </Outline>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </Outline>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </Outline>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </Outline>
  );
}

/** A magnifier with an x inside: nothing found. */
export function SearchOffIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      <path d="M8.75 8.75l4.5 4.5m0-4.5l-4.5 4.5" />
    </Outline>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
    </Outline>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M3 3l18 18M8.288 15.038a5.25 5.25 0 013.9-1.04M5.106 11.856a9.5 9.5 0 013.2-2.1M1.924 8.674a14.2 14.2 0 015.2-3.1M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0zM16.7 10.6a9.5 9.5 0 012.2 1.256M19.4 6.9a14.2 14.2 0 012.7 1.774" />
    </Outline>
  );
}

/** The Share button in Safari: a square with an arrow leaving it (Heroicons "arrow-up-on-square"). */
export function ShareIosIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0016.5 8.25H15M12 3v12.75M8.25 6.75L12 3l3.75 3.75" />
    </Outline>
  );
}

export function ExclamationIcon(props: IconProps) {
  return (
    <Outline strokeWidth={3} {...props}>
      <path d="M12 7v6m0 3.5h.01" />
    </Outline>
  );
}

// --- Scripture Reading (06) and Translation Selection (12) ---

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Outline>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M6 9l6 6 6-6" />
    </Outline>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </Outline>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Outline strokeWidth={3} {...props}>
      <path d="M5 13l4 4L19 7" />
    </Outline>
  );
}

/** Two open pages, the "Read in chapter" icon. */
export function PagesIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Outline>
  );
}

/** Reader action bookmark: outline, or filled once the verse is saved. */
export function SaveBookmarkIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Outline {...props} {...(filled ? { fill: "currentColor" } : {})}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Outline>
  );
}

export function ShareNodesIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
    </Outline>
  );
}

export function CopyDocIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Outline>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Outline>
  );
}

export function StopSquareIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Outline>
  );
}

// --- Chapter reader (Stitch 22) ---

export function PersonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.33 0-8 1.67-8 5v1h16v-1c0-3.33-4.67-5-8-5z" />
    </svg>
  );
}

export function QuillIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M20 4c-6 0-11 3-13 9l-1.5 4.5L10 16c6-2 9-7 10-12z" />
      <path d="M6.5 17.5L3 21M9 13l4 4" />
    </Outline>
  );
}

export function HubIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="5" cy="6" r="1.8" />
      <circle cx="19" cy="6" r="1.8" />
      <circle cx="5" cy="18" r="1.8" />
      <circle cx="19" cy="18" r="1.8" />
      <path d="M6.4 7.2l3.9 3.3M17.6 7.2l-3.9 3.3M6.4 16.8l3.9-3.3M17.6 16.8l-3.9-3.3" />
    </Outline>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.4L6.6 12.2l1.4-1.4 2.8 2.8 5.2-5.2 1.4 1.4-6.6 6.6z" />
    </svg>
  );
}

// --- Book & Chapter Index (Stitch 21) ---

export function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" />
    </svg>
  );
}

export function InfinityIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M18.2 8.2c-2.6 0-4.1 2.2-6.2 3.8-2.1 1.6-3.6 3.8-6.2 3.8a3.8 3.8 0 010-7.6c2.6 0 4.1 2.2 6.2 3.8 2.1 1.6 3.6 3.8 6.2 3.8a3.8 3.8 0 000-7.6z" />
    </Outline>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props}>
      <path d="M18 15l-6-6-6 6" />
    </Outline>
  );
}

// --- Verse selection & annotation (Stitch 23) ---

export function CompareArrowsIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path
        d="M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z"
        fill="currentColor"
        stroke="none"
      />
    </Outline>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M12 3a9 9 0 100 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4.1-4-7.4-9-7.4z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </Outline>
  );
}

export function EditNoteIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M4 7h11M4 12h7M4 17h5" />
      <path d="M13.5 18.5l.5-2.5 6-6a1.4 1.4 0 012 2l-6 6-2.5.5z" />
    </Outline>
  );
}

export function TuneIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Outline>
  );
}

export function EraserIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M16.2 4.8a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8L11 18H6.5L3.8 15.3a2 2 0 010-2.8l12.4-7.7z" />
      <path d="M9 19h11" />
    </Outline>
  );
}

export function MoreHorizIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.4} {...props}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </Outline>
  );
}

export function ListBulletIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M9 6.75h11M9 12h11M9 17.25h11" />
      <path d="M4.5 6.75h.01M4.5 12h.01M4.5 17.25h.01" strokeWidth={2.6} />
    </Outline>
  );
}

/** The Material "format_quote" mark, drawn filled. */
export function QuoteIcon(props: Omit<SVGProps<SVGSVGElement>, "children">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </Outline>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </Outline>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M12 4.5v15m7.5-7.5h-15" />
    </Outline>
  );
}

export function FlashIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12l1-8z" />
    </Outline>
  );
}

export function FlashOffIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M13 2.5l-2.6 3.4M8.2 8.7L4.5 13.5H11l-1 8 3.6-4.7M15.9 13.2l2.6-3.2H12l1-7.5" />
      <path d="M3.5 3.5l17 17" />
    </Outline>
  );
}

export function GalleryIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </Outline>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
    </Outline>
  );
}

export function FlipCameraIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M6.8 6.5l.9-1.4A2 2 0 019.4 4h5.2a2 2 0 011.7 1.1l.9 1.4H19a2 2 0 012 2V17a2 2 0 01-2 2H5a2 2 0 01-2-2V8.5a2 2 0 012-2h1.8z" />
      <path d="M9 12.5a3 3 0 015.2-2l.8.8M15 12.5a3 3 0 01-5.2 2l-.8-.8M15 9.8v1.5h-1.5M9 15.2v-1.5h1.5" />
    </Outline>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.75" />
      <path d="M4.5 5.5v6.5c0 1.52 3.36 2.75 7.5 2.75s7.5-1.23 7.5-2.75V5.5M4.5 12v6.5c0 1.52 3.36 2.75 7.5 2.75s7.5-1.23 7.5-2.75V12" />
    </Outline>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
      <path d="M9 12l2 2 4-4" />
    </Outline>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Outline>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Outline>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
    </Outline>
  );
}

/** A highlighter marker (Stitch "ink_highlighter"). */
export function HighlighterIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M15.5 3.5l5 5-9.5 9.5-5-5 9.5-9.5z" />
      <path d="M6 13l5 5-3.2.7L4 20l.7-3.8L6 13z" />
      <path d="M13 21h8" />
    </Outline>
  );
}

/** Equaliser bars (Stitch "graphic_eq"). */
export function GraphicEqIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props}>
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </Outline>
  );
}

/** A speaking head with sound waves (Stitch "record_voice_over"). */
export function RecordVoiceIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16.5 5.5a4 4 0 010 5M19 3a7.5 7.5 0 010 10" />
    </Outline>
  );
}

/** A tree in a quiet landscape (Stitch "nature_people"). */
export function NatureIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M12 21v-6" />
      <path d="M12 15c-3.9 0-6.5-2.6-6.5-5.8C5.5 6.1 8.2 3 12 3s6.5 3.1 6.5 6.2c0 3.2-2.6 5.8-6.5 5.8z" />
      <path d="M12 12l-2-2M12 9l2-2" />
    </Outline>
  );
}

/** A cloud with a sync arrow (Stitch "cloud_sync"). */
export function CloudSyncIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0117.9 8.6 4.7 4.7 0 0117 18" />
      <path d="M9.5 15.5a3 3 0 015-1.8l.8.8M14.5 17.5a3 3 0 01-5-1.8l-.8-.8" />
      <path d="M15.3 12v2.5h-2.5M8.7 19.5V17h2.5" />
    </Outline>
  );
}

/** A bin, for removing something (Stitch "delete"). */
export function TrashIcon(props: IconProps) {
  return (
    <Outline strokeWidth={1.8} {...props}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </Outline>
  );
}
