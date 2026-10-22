import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { offlineSwBuild, OFFLINE_IN_PRODUCTION } from "../../scripts/sw/flag.mjs";
import {
  isIosSafari,
  isNativeRuntime,
  isStandalone,
  shouldShowIosGuide,
  type InstallEnvironment,
} from "@/lib/install-guide";

const root = join(__dirname, "..", "..");
const template = readFileSync(join(root, "scripts/sw/sw.template.js"), "utf8");
// The worker's code without its comments (which say what it never touches).
const code = template.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("which builds ship the offline worker", () => {
  it("Production stays off until the owner flips the switch", () => {
    expect(OFFLINE_IN_PRODUCTION).toBe(false);
    expect(offlineSwBuild({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("Preview builds ship it; a plain local build does not", () => {
    expect(offlineSwBuild({ VERCEL_ENV: "preview" })).toBe(true);
    expect(offlineSwBuild({})).toBe(false);
    expect(offlineSwBuild({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("OFFLINE_SW overrides for local testing, in both directions", () => {
    expect(offlineSwBuild({ OFFLINE_SW: "1" })).toBe(true);
    expect(offlineSwBuild({ OFFLINE_SW: "1", VERCEL_ENV: "production" })).toBe(true);
    expect(offlineSwBuild({ OFFLINE_SW: "0", VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("the service worker template stays minimal and safe", () => {
  // The worker only ever sees a request through its fetch handler: look at what it can respond to.
  it("handles only GET requests", () => {
    expect(template).toMatch(/request\.method !== "GET"\) return/);
  });

  it("leaves every other origin alone except Google Fonts, so Supabase and the Bible service are untouched", () => {
    expect(template).toMatch(/url\.origin !== self\.location\.origin\) return/);
    expect(code).not.toMatch(/supabase|helloao|openai/i);
    const origins = [...template.matchAll(/https:\/\/[a-z.]+/g)].map((m) => m[0]);
    expect([...new Set(origins)].sort()).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
  });

  it("caches only built files and the shell: never server functions, API routes or HTML pages by address", () => {
    expect(template).toContain('const STATIC_PREFIXES = ["/assets/", "/icons/", "/stitch/"]');
    expect(template).not.toMatch(/_serverFn|\/api\//);
    // The only HTML ever stored is the one shell document, under one fixed key.
    expect((template.match(/cache\.put\(/g) ?? []).length).toBe(4);
    expect(template).toContain("cache.put(SHELL_KEY, shell)");
  });

  it("falls back to the shell for navigations only when the network fails", () => {
    expect(template).toMatch(/request\.mode === "navigate"/);
    expect(template).toMatch(/catch \{\s*return await shellResponse\(\)/);
  });

  it("versions its cache per build and keeps the newest two", () => {
    expect(template).toContain("const CACHE = PREFIX + VERSION");
    expect(template).toContain("names.slice(-2)");
  });

  it("is a template: the build fills in the version and the file list", () => {
    expect(template).toContain('"__VERSION__"');
    expect(template).toContain("__PRECACHE__");
  });
});

describe("the iPhone install guide", () => {
  const iphoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const base: InstallEnvironment = {
    userAgent: iphoneSafari,
    platform: "iPhone",
    maxTouchPoints: 5,
    standalone: false,
    displayModeStandalone: false,
    nativeRuntime: false,
  };
  const allowed = { dismissed: false };

  it("shows in Safari on an iPhone that has not installed the app", () => {
    expect(isIosSafari(base)).toBe(true);
    expect(shouldShowIosGuide(base, allowed)).toBe(true);
  });

  it("recognises an iPad that presents itself as a Mac", () => {
    const ipad = {
      ...base,
      userAgent: iphoneSafari.replaceAll("iPhone", "Macintosh"),
      platform: "MacIntel",
    };
    expect(isIosSafari(ipad)).toBe(true);
    expect(isIosSafari({ ...ipad, maxTouchPoints: 0 })).toBe(false); // a real Mac
  });

  it("stays away from other browsers and in-app web views", () => {
    for (const marker of [
      "CriOS/126.0",
      "FxiOS/127.0",
      "EdgiOS/126.0",
      "FBAN/FBIOS",
      "Instagram 330",
    ]) {
      expect(isIosSafari({ ...base, userAgent: `${iphoneSafari} ${marker}` })).toBe(false);
    }
    expect(isIosSafari({ ...base, userAgent: iphoneSafari.replace(" Safari/604.1", "") })).toBe(
      false,
    );
  });

  it("stays away on Android and desktop", () => {
    const android =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
    expect(
      shouldShowIosGuide({ ...base, userAgent: android, platform: "Linux armv8l" }, allowed),
    ).toBe(false);
  });

  it("stays away once the app runs from the Home Screen, either way the browser says so", () => {
    expect(isStandalone({ ...base, standalone: true })).toBe(true);
    expect(shouldShowIosGuide({ ...base, standalone: true }, allowed)).toBe(false);
    expect(shouldShowIosGuide({ ...base, displayModeStandalone: true }, allowed)).toBe(false);
  });

  it("does not depend on any download: the environment and the choices are all it looks at", () => {
    expect(shouldShowIosGuide(base, allowed)).toBe(true);
    expect(Object.keys(allowed).sort()).toEqual(["dismissed"]);
  });

  it("stays hidden after a dismissal", () => {
    expect(shouldShowIosGuide(base, { ...allowed, dismissed: true })).toBe(false);
  });

  it("never shows in a native app build, even on an iPhone in Safari-like conditions", () => {
    expect(shouldShowIosGuide({ ...base, nativeRuntime: true }, allowed)).toBe(false);
  });

  it("knows it is native from the build flag or a Capacitor shell, not from the device", () => {
    vi.stubGlobal("window", {});
    expect(isNativeRuntime()).toBe(false);
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    expect(isNativeRuntime()).toBe(true);
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => false } });
    expect(isNativeRuntime()).toBe(false);
    vi.unstubAllGlobals();
    vi.stubEnv("VITE_NATIVE_APP", "true");
    vi.stubGlobal("window", {});
    expect(isNativeRuntime()).toBe(true);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
