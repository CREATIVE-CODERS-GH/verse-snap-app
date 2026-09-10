import { tesseractProvider } from "./tesseract-provider";
import type { OcrProvider, OcrResult } from "./types";

/** Swap this to change OCR engines; screens stay untouched. */
const provider: OcrProvider = tesseractProvider;

export const ocrService = {
  recognize(image: Blob): Promise<OcrResult> {
    return provider.recognize(image);
  },
};

export type { OcrResult };
