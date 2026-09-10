import type { BibleProvider } from "./types";

/**
 * PLACEHOLDER — Free Use Bible API by AO Lab (https://bible.helloao.org/).
 *
 * The endpoint paths and response shapes have not been verified yet, so no
 * requests are made here on purpose. When we wire this up we will:
 *   1. Confirm the documented endpoints for translation list, chapter text
 *      and verse text at https://bible.helloao.org/
 *   2. Map their book identifiers to the ids used in `books.ts`
 *   3. Implement the three methods below and swap the provider in `service.ts`
 *
 * Nothing else in the app needs to change when that happens.
 */
export const helloAoProvider: BibleProvider = {
  async listTranslations() {
    throw new Error("helloAoProvider.listTranslations is not implemented yet");
  },
  async getVerse() {
    throw new Error("helloAoProvider.getVerse is not implemented yet");
  },
  async getNeighbour() {
    throw new Error("helloAoProvider.getNeighbour is not implemented yet");
  },
};
