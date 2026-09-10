import type { OcrProvider, OcrResult } from "./types";

/**
 * Browser-only OCR through tesseract.js. The engine and its language data are
 * loaded lazily on first use so the main bundle stays small, and the worker is
 * terminated after each read so nothing keeps running in the background.
 * Images never leave the device.
 */
export const tesseractProvider: OcrProvider = {
  async recognize(image: Blob): Promise<OcrResult> {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(image);
      return { text: data.text ?? "", confidence: data.confidence ?? 0 };
    } finally {
      await worker.terminate();
    }
  },
};
