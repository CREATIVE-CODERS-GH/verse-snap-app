import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards for the Stitch "04 — Home Screen" rebuild: navigation, onboarding, analytics and the
// token layer must stay intact. (Visual checks are done in a real browser.)
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("Home screen", () => {
  const home = read("src/routes/index.tsx");

  it("links the three action cards to voice, scan and search", () => {
    expect(home).toMatch(/to="\/voice"[\s\S]*?title="Say a Verse"/);
    expect(home).toMatch(/to="\/scan"[\s\S]*?title="Snap a Verse"/);
    expect(home).toMatch(/to="\/search"[\s\S]*?title="Search the Bible"/);
  });

  it("keeps the settings link, onboarding gate and analytics", () => {
    expect(home).toContain('to="/settings"');
    expect(home).toContain('aria-label="Settings"');
    expect(home).toContain("hasCompletedOnboarding()");
    expect(home).toContain('trackEvent("app_open")');
    expect(home).toContain('trackEvent("onboarding_completed")');
  });

  it("uses the Stitch frame and does not render Continue reading or Recent", () => {
    expect(home).toContain('variant="stitch"');
    expect(home).not.toMatch(/ContinueReadingCard|RecentVerses|listHistory/);
  });

  it("keeps the previous Home sections available for later placement", () => {
    const sections = read("src/components/home-sections.tsx");
    expect(sections).toContain("export function ContinueReadingCard");
    expect(sections).toContain("export function RecentVerses");
    expect(sections).toContain("library.listHistory(4, user?.id)");
  });

  it("does not touch search, auth or database code", () => {
    for (const file of ["src/routes/index.tsx", "src/components/action-card.tsx"]) {
      expect(read(file)).not.toMatch(/supabase|searchScripture|bibleService|allowPaidSearch/);
    }
  });
});

describe("shared tab bar", () => {
  const nav = read("src/components/bottom-nav.tsx");

  it("has the five approved tabs in order", () => {
    const labels = [...nav.matchAll(/<span className=\{LABEL_CLASS\}>(\w+)<\/span>/g)].map(
      (match) => match[1],
    );
    expect([...labels].sort()).toEqual(["History", "Home", "Read", "Saved", "Settings"]);
    expect(nav.indexOf('to="/"')).toBeLessThan(nav.indexOf("<ReadTab />"));
    expect(nav.indexOf("<ReadTab />")).toBeLessThan(nav.indexOf('to="/saved"'));
    expect(nav.indexOf('to="/saved"')).toBeLessThan(nav.indexOf('to="/history"'));
    expect(nav.indexOf('to="/history"')).toBeLessThan(nav.indexOf('to="/settings"'));
  });

  it("keeps the Read tab opening the last-read chapter", () => {
    expect(nav).toContain("getLastRead()");
    expect(nav).toContain('"/chapter/$translation/$book/$chapter"');
  });
});

describe("design tokens (Option B)", () => {
  const css = read("src/styles.css");

  it("adds the Stitch fonts and light tokens without replacing the app tokens", () => {
    expect(css).toContain('--font-display: "Playfair Display"');
    expect(css).toContain('--font-stitch: "Inter"');
    expect(css).toContain("--vs-primary: #1f5f4a;");
    expect(css).toContain("--vs-bg: #faf8f5;");
    expect(css).toContain('--font-serif: "Source Serif 4"');
    expect(css).toContain('--font-sans: "Libre Franklin"');
  });

  it("marks the dark values as provisional", () => {
    expect(css).toContain("PROVISIONAL dark values");
    expect(css.split("--vs-voice-from:").length).toBe(3); // light + dark
  });
});
