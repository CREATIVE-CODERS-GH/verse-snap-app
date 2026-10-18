import { afterEach, describe, expect, it, mock } from "bun:test";
import { helloAoProvider } from "./helloao-provider";
import { resolveTranslation } from "./translations";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Bible edition lookup", () => {
  for (const [code, apiId] of [["KJAV", "eng_kjv"], ["BSB", "BSB"], ["WEB", "ENGWEBP"], ["ASV", "eng_asv"], ["BBE", "eng_bbe"]]) {
    it(`loads and labels ${code} from its own edition`, async () => {
      const request = mock(async () => Response.json({ chapter: { content: [
        { type: "verse", number: 16, content: [`${code} passage`] },
      ] } }));
      globalThis.fetch = request;
      const verse = await helloAoProvider.getVerse({ bookId: "john", bookName: "John", chapter: 3, verse: 16 }, code);
      expect(request.mock.calls[0][0]).toBe(`https://bible.helloao.org/api/${apiId}/JHN/3.json`);
      expect(verse.translation).toBe(code);
      expect(verse.text).toBe(`${code} passage`);
    });
  }
  it("preserves existing KJV links", () => {
    expect(resolveTranslation("KJV").code).toBe("KJAV");
    expect(resolveTranslation("KJV").apiId).toBe("eng_kjv");
  });
  it("keeps words separated around footnotes in modern editions", async () => {
    globalThis.fetch = mock(async () => Response.json({ chapter: { content: [
      { type: "verse", number: 16, content: ["His one and only", { noteId: 17 }, "Son"] },
    ] } }));
    const verse = await helloAoProvider.getVerse({ bookId: "john", bookName: "John", chapter: 3, verse: 16 }, "BSB");
    expect(verse.text).toBe("His one and only Son");
  });
  it("does not silently substitute an unsupported edition", () => {
    expect(() => resolveTranslation("NIV")).toThrow("That translation is not available.");
  });
});