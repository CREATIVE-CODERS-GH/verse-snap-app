import type { OcrProvider, OcrResult } from "./types";

/**
 * Browser-only OCR through tesseract.js. The engine and its language data are
 * loaded lazily on first use so the main bundle stays small, and the worker is
 * terminated after each read so nothing keeps running in the background.
 * Images never leave the device.
 */
export const tesseractProvider: OcrProvider = {
  async recognize(image: Blob): Promise<OcrResult> {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const readings: OcrResult[] = [];
      for (const mode of [PSM.SINGLE_BLOCK, PSM.SINGLE_LINE, PSM.SPARSE_TEXT]) {
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        const { data } = await worker.recognize(image);
        readings.push({ text: data.text?.trim() ?? "", confidence: data.confidence ?? 0 });
        // Avoid extra work when the short-text pass is already dependable.
        if (readings.length === 1 && data.confidence >= 82 && data.text?.trim()) break;
      }

      const best = readings.reduce(
        (current, reading) => (reading.confidence > current.confidence ? reading : current),
        readings[0] ?? { text: "", confidence: 0 },
      );
      const uniqueText = [
        best.text,
        ...readings.filter((reading) => reading !== best).map(({ text }) => text),
      ]
        .filter((text, index, all) => Boolean(text) && all.indexOf(text) === index)
        .join("\n");
      return {
        text: uniqueText,
        confidence: best.confidence,
      };
    } finally {
      await worker.terminate();
    }
  },
};
