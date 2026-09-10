const MAX_EDGE = 1280;

/**
 * Draws the current video frame to an off-screen canvas, downscaled so OCR
 * stays fast on phones, and returns it as a JPEG blob. The canvas is discarded
 * as soon as the blob is produced; no image is stored.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
  });
}

/** Downscales an uploaded image file the same way before OCR. */
export async function prepareImageFile(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.9);
    });
  } finally {
    bitmap.close();
  }
}
