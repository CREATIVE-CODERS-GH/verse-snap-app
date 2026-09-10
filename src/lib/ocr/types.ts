export interface OcrResult {
  /** Recognised text, may be empty. */
  text: string;
  /** 0–100 recognition confidence reported by the engine. */
  confidence: number;
}

export interface OcrProvider {
  /** Reads text from an image. Implementations must release resources themselves. */
  recognize(image: Blob): Promise<OcrResult>;
}
