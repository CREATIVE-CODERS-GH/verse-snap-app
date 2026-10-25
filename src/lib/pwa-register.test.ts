import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_ENABLED,
  isAppWorker,
  isRefusedContext,
  registerServiceWorker,
  shouldRegister,
} from "@/lib/pwa-register";

const production = { prod: true, inFrame: false, hostname: "my-bible-lake.vercel.app", search: "" };

describe("service worker registration (offline support not built yet)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is switched off, so production never registers a worker", () => {
    expect(OFFLINE_ENABLED).toBe(false);
    expect(shouldRegister(production)).toBe(false);
  });

  it("would only register in a normal production context once enabled", () => {
    expect(shouldRegister(production, true)).toBe(true);
    expect(shouldRegister({ ...production, prod: false }, true)).toBe(false);
    expect(shouldRegister({ ...production, inFrame: true }, true)).toBe(false);
    expect(shouldRegister({ ...production, search: "?sw=off" }, true)).toBe(false);
    for (const hostname of [
      "id-preview--abc.lovable.app",
      "preview--abc.lovable.app",
      "x.lovableproject.com",
      "x.lovableproject-dev.com",
      "x.beta.lovable.dev",
    ]) {
      expect(isRefusedContext({ ...production, hostname }), hostname).toBe(true);
    }
  });

  it("recognises only this app's own worker", () => {
    const origin = "https://my-bible-lake.vercel.app";
    expect(isAppWorker(`${origin}/sw.js`, origin)).toBe(true);
    expect(isAppWorker(`${origin}/other-sw.js`, origin)).toBe(false);
    expect(isAppWorker(`${origin}/push/sw.js`, origin)).toBe(false);
    expect(isAppWorker("https://elsewhere.example/sw.js", origin)).toBe(false);
    expect(isAppWorker(undefined, origin)).toBe(false);
    expect(isAppWorker("not a url", origin)).toBe(false);
  });

  it("never calls register, and unregisters only the Verse Snap worker", async () => {
    const origin = "https://my-bible-lake.vercel.app";
    const ours = { active: { scriptURL: `${origin}/sw.js` }, unregister: vi.fn() };
    const waitingOurs = { waiting: { scriptURL: `${origin}/sw.js` }, unregister: vi.fn() };
    const other = {
      active: { scriptURL: `${origin}/firebase-messaging-sw.js` },
      unregister: vi.fn(),
    };
    const register = vi.fn();
    vi.stubGlobal("window", {
      self: 1,
      top: 1,
      location: { hostname: "my-bible-lake.vercel.app", search: "", origin },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { register, getRegistrations: async () => [ours, waitingOurs, other] },
    });
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
    expect(ours.unregister).toHaveBeenCalledTimes(1);
    expect(waitingOurs.unregister).toHaveBeenCalledTimes(1);
    expect(other.unregister).not.toHaveBeenCalled();
  });

  it("does nothing where service workers are unsupported", async () => {
    vi.stubGlobal("window", {
      self: 1,
      top: 1,
      location: { hostname: "x", search: "", origin: "x" },
    });
    vi.stubGlobal("navigator", {});
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });

  it("ships no placeholder service worker and no PWA build plugin", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
    expect(() => read("public/sw.js")).toThrow();
    expect(read("vite.config.ts")).not.toMatch(/vite-plugin-pwa|VitePWA/);
    expect(JSON.parse(read("package.json")).devDependencies["vite-plugin-pwa"]).toBeUndefined();
    // The manifest and icons stay, so Add to Home Screen keeps working.
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/maskable-512.png",
    ]);
  });
});
