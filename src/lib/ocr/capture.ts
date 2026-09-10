const TARGET_WIDTH = 1800;
const MAX_EDGE = 2200;

interface ImageSource {
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Produces a high-contrast grayscale image with a light unsharp mask. This is
 * deliberately local canvas work: the source pixels are discarded afterwards.
 */
function drawForOcr(
  source: CanvasImageSource,
  dimensions: ImageSource,
  cropToGuide: boolean,
): Promise<Blob | null> {
  const cropWidth = cropToGuide ? dimensions.width * 0.88 : dimensions.width;
  const cropHeight = cropToGuide ? dimensions.height * 0.34 : dimensions.height;
  const sourceX = (dimensions.width - cropWidth) / 2;
  const sourceY = (dimensions.height - cropHeight) / 2;
  const scale = Math.min(MAX_EDGE / Math.max(cropWidth, cropHeight), Math.max(1, TARGET_WIDTH / cropWidth));
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return Promise.resolve(null);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "grayscale(1) contrast(1.55) brightness(1.06)";
  context.drawImage(source, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);
  context.filter = "none";

  const image = context.getImageData(0, 0, width, height);
  const original = new Uint8ClampedArray(image.data);
  const data = image.data;
  // A restrained 3x3 sharpen kernel also suppresses faint background texture.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      const center = original[index] ?? 0;
      const north = original[index - width * 4] ?? center;
      const south = original[index + width * 4] ?? center;
      const west = original[index - 4] ?? center;
      const east = original[index + 4] ?? center;
      const sharpened = Math.max(0, Math.min(255, center * 5 - north - south - west - east));
      const cleaned = sharpened < 28 ? 0 : sharpened > 232 ? 255 : sharpened;
      data[index] = cleaned;
      data[index + 1] = cleaned;
      data[index + 2] = cleaned;
    }
  }
  context.putImageData(image, 0, 0);
  return canvasToBlob(canvas);
}

/**
 * Draws the guide area to an off-screen canvas, enhanced for OCR, and returns
 * it as a PNG blob. The canvas is discarded as soon as the blob is produced;
 * no image is stored.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);

  return drawForOcr(video, { width, height }, true);
}

/** Enhances an uploaded image without cropping, since its subject can be anywhere. */
export async function prepareImageFile(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    return (await drawForOcr(bitmap, bitmap, false)) ?? file;
  } finally {
    bitmap.close();
  }
}
