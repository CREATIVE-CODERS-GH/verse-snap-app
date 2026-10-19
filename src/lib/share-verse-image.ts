import type { Verse } from "./bible/types";
import { translationName } from "./bible/translations";

/**
 * Renders a verse into a branded PNG card, entirely on the device.
 * No network, no uploads — works offline and keeps the app's quiet look.
 */

const WIDTH = 1080;
const HEIGHT = 1350;
const PADDING = 96;

const COLORS = {
  background: "#fcfaf6",
  text: "#1c1917",
  muted: "#78716c",
  accent: "#8a6d3b",
  rule: "#e7e2d8",
};

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 52px "Source Serif 4"'),
      document.fonts.load('600 30px "Libre Franklin"'),
      document.fonts.load('500 26px "Libre Franklin"'),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

/** Greedy word wrap for a canvas context at the current font. */
function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function createVerseImageBlob(verse: Verse): Promise<Blob> {
  await ensureFonts();

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available on this device");

  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  const maxWidth = WIDTH - PADDING * 2;

  // Brand mark, small and quiet, top left.
  context.fillStyle = COLORS.accent;
  context.font = '600 26px "Libre Franklin", system-ui, sans-serif';
  context.textBaseline = "alphabetic";
  context.fillText("VERSE SNAP", PADDING, PADDING + 10);

  // Verse text in serif, sized down until it fits the card.
  let fontSize = 56;
  let lines: string[] = [];
  let lineHeight = 0;
  for (; fontSize >= 32; fontSize -= 4) {
    context.font = `400 ${fontSize}px "Source Serif 4", Georgia, serif`;
    lineHeight = Math.round(fontSize * 1.45);
    lines = wrapLines(context, verse.text, maxWidth);
    const blockHeight = lines.length * lineHeight;
    if (blockHeight <= HEIGHT - PADDING * 2 - 260) break;
  }

  // Vertically center the verse between the brand mark and the footer.
  const blockHeight = lines.length * lineHeight;
  const footerReserve = 260;
  const textTop = Math.max(
    PADDING + 120,
    Math.round((HEIGHT - footerReserve - blockHeight) / 2) + Math.round(lineHeight * 0.75),
  );
  context.fillStyle = COLORS.text;
  lines.forEach((line, index) => {
    context.fillText(line, PADDING, textTop + index * lineHeight);
  });

  // Reference + translation, anchored near the bottom.
  const footerTop = HEIGHT - PADDING - 120;
  context.strokeStyle = COLORS.rule;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PADDING, footerTop);
  context.lineTo(PADDING + 72, footerTop);
  context.stroke();

  context.fillStyle = COLORS.text;
  context.font = '600 34px "Libre Franklin", system-ui, sans-serif';
  context.fillText(verse.reference, PADDING, footerTop + 58);

  context.fillStyle = COLORS.muted;
  context.font = '500 26px "Libre Franklin", system-ui, sans-serif';
  context.fillText(
    `${verse.translation} · ${translationName(verse.translation)}`,
    PADDING,
    footerTop + 100,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create the image"));
    }, "image/png");
  });
}

export function verseImageFileName(verse: Verse): string {
  const slug = verse.reference.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `verse-snap-${slug}-${verse.translation.toLowerCase()}.png`;
}
