import type { Verse } from "./bible/types";

/**
 * Verse Card Creator Studio (Stitch 26): the card designs and an on-device PNG renderer that
 * matches the on-screen preview. Nothing is uploaded; the image is drawn on a canvas.
 */

export type CardTheme = "pine" | "morning" | "parchment" | "slate" | "dawn";
export type CardFormat = "story" | "square" | "portrait";
export type CardType = "serif" | "sans" | "grace";

export interface CardThemeInfo {
  id: CardTheme;
  label: string;
  name: string;
  /** Swatch colour in the picker. */
  swatch: string;
  /** Gradient stops (top, bottom), used when there is no photo. */
  stops: [string, string];
  photo?: string;
  text: string;
  muted: string;
  /** Background of the translation chip. */
  chip: string;
}

export const CARD_THEMES: readonly CardThemeInfo[] = [
  {
    id: "pine",
    label: "Pine",
    name: "Misty Pine",
    swatch: "#1f5f4a",
    stops: ["#1d3a30", "#0f1f1a"],
    photo: "/stitch/card-pine.jpg",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.78)",
    chip: "rgba(255,255,255,0.2)",
  },
  {
    id: "morning",
    label: "Morning",
    name: "Morning Light",
    swatch: "#f6c9a0",
    stops: ["#ffe9c9", "#f3c49b"],
    text: "#3b2a1a",
    muted: "rgba(59,42,26,0.7)",
    chip: "rgba(59,42,26,0.1)",
  },
  {
    id: "parchment",
    label: "Parchment",
    name: "Old Parchment",
    swatch: "#eadbc0",
    stops: ["#f8f1e3", "#e8d7b8"],
    text: "#3a2f22",
    muted: "rgba(58,47,34,0.7)",
    chip: "rgba(58,47,34,0.1)",
  },
  {
    id: "slate",
    label: "Slate",
    name: "Evening Slate",
    swatch: "#2d3748",
    stops: ["#334155", "#141a24"],
    text: "#ffffff",
    muted: "rgba(255,255,255,0.75)",
    chip: "rgba(255,255,255,0.16)",
  },
  {
    id: "dawn",
    label: "Dawn",
    name: "Quiet Dawn",
    swatch: "#c9b6e4",
    stops: ["#f8dbe4", "#c7b4e6"],
    text: "#2e2440",
    muted: "rgba(46,36,64,0.7)",
    chip: "rgba(46,36,64,0.1)",
  },
];

export const CARD_FORMATS: Record<
  CardFormat,
  { label: string; width: number; height: number; ratio: string }
> = {
  story: { label: "9:16 Story", width: 1080, height: 1920, ratio: "9 / 16" },
  square: { label: "1:1 Square", width: 1080, height: 1080, ratio: "1 / 1" },
  portrait: { label: "4:5 Portrait", width: 1080, height: 1350, ratio: "4 / 5" },
};

export const CARD_TYPES: Record<
  CardType,
  { label: string; note: string; css: string; canvas: (px: number) => string }
> = {
  serif: {
    label: "Serif",
    note: "Editorial",
    css: "font-display",
    canvas: (px) => `500 ${px}px "Playfair Display", Georgia, serif`,
  },
  sans: {
    label: "Sans",
    note: "Modern",
    css: "font-stitch",
    canvas: (px) => `500 ${px}px "Inter", system-ui, sans-serif`,
  },
  grace: {
    label: "Grace",
    note: "Poetic",
    css: "font-display italic",
    canvas: (px) => `italic 400 ${px}px "Playfair Display", Georgia, serif`,
  },
};

export function cardTheme(id: CardTheme): CardThemeInfo {
  return CARD_THEMES.find((theme) => theme.id === id) ?? CARD_THEMES[0]!;
}

export interface CardOptions {
  theme: CardTheme;
  format: CardFormat;
  type: CardType;
  /** 0.8 – 1.3, the Text Scale slider. */
  scale: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the background"));
    image.src = src;
  });
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the card exactly as previewed and returns a PNG. */
export async function renderVerseCard(verse: Verse, options: CardOptions): Promise<Blob> {
  const theme = cardTheme(options.theme);
  const { width, height } = CARD_FORMATS[options.format];
  const type = CARD_TYPES[options.type];
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await Promise.all([
        document.fonts.load(type.canvas(60)),
        document.fonts.load('600 32px "Inter"'),
      ]);
    } catch {
      /* system fonts are fine */
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available on this device");

  // Background: photo (cover) with a soft dark wash, or the theme gradient.
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.stops[0]);
  gradient.addColorStop(1, theme.stops[1]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  if (theme.photo) {
    try {
      const image = await loadImage(theme.photo);
      const scale = Math.max(width / image.width, height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
      const wash = context.createLinearGradient(0, 0, 0, height);
      wash.addColorStop(0, "rgba(0,0,0,0.4)");
      wash.addColorStop(0.5, "rgba(0,0,0,0.12)");
      wash.addColorStop(1, "rgba(0,0,0,0.6)");
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);
    } catch {
      /* the gradient stays */
    }
  }

  const pad = Math.round(width * 0.08);
  context.textBaseline = "alphabetic";

  // Translation chip, top left.
  context.font = '600 30px "Inter", system-ui, sans-serif';
  const chipText = verse.translation;
  const chipW = context.measureText(chipText).width + 44;
  context.fillStyle = theme.chip;
  context.beginPath();
  context.roundRect(pad, pad, chipW, 54, 27);
  context.fill();
  context.fillStyle = theme.text;
  context.fillText(chipText, pad + 22, pad + 38);

  // Verse, centred, shrinking until it fits.
  const maxWidth = width - pad * 2;
  const available = height - pad * 2 - 320;
  let size = Math.round(width * 0.062 * options.scale);
  let lines: string[] = [];
  let lineHeight = 0;
  for (; size >= 28; size -= 2) {
    context.font = type.canvas(size);
    lineHeight = Math.round(size * 1.4);
    lines = wrap(context, verse.text, maxWidth);
    if (lines.length * lineHeight <= available) break;
  }
  const block = lines.length * lineHeight;
  const top = Math.round((height - block) / 2);
  context.textAlign = "center";
  context.fillStyle = theme.muted;
  context.font = type.canvas(Math.round(size * 1.6));
  context.fillText("“", width / 2, top - Math.round(size * 0.35));
  context.fillStyle = theme.text;
  context.font = type.canvas(size);
  lines.forEach((line, index) => {
    context.fillText(line, width / 2, top + Math.round(lineHeight * 0.8) + index * lineHeight);
  });

  // Footer: reference left, brand right.
  context.textAlign = "left";
  context.fillStyle = theme.text;
  context.font = '600 34px "Inter", system-ui, sans-serif';
  context.fillText(verse.reference, pad, height - pad);
  context.textAlign = "right";
  context.fillStyle = theme.muted;
  context.font = '600 26px "Inter", system-ui, sans-serif';
  context.fillText("VERSE SNAP", width - pad, height - pad);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))),
      "image/png",
    );
  });
}

export function cardFileName(verse: Verse, format: CardFormat): string {
  const slug = verse.reference
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `verse-snap-${slug}-${format}.png`;
}
