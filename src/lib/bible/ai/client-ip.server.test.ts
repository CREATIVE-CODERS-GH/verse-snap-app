import { describe, expect, it } from "vitest";
import {
  UNKNOWN_CLIENT,
  hashClientIp,
  isOnVercel,
  normalizeIp,
  resolveClientIp,
} from "./client-ip.server";

const SALT = "unit-test-salt-0123456789abcdef0123456789";

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("resolveClientIp", () => {
  it("off Vercel ignores every forwarding header and uses the socket address", () => {
    const ip = resolveClientIp({
      headers: headers({
        "x-forwarded-for": "198.51.100.7",
        "x-real-ip": "198.51.100.8",
        "x-vercel-forwarded-for": "198.51.100.9",
        "cf-connecting-ip": "198.51.100.10",
      }),
      socketIp: "203.0.113.5",
      onVercel: false,
    });
    expect(ip).toBe("203.0.113.5");
  });

  it("gives the same bucket whatever a local caller puts in spoofed headers", () => {
    const a = resolveClientIp({
      headers: headers({ "x-forwarded-for": "1.1.1.1" }),
      socketIp: "203.0.113.5",
      onVercel: false,
    });
    const b = resolveClientIp({
      headers: headers({ "x-forwarded-for": "2.2.2.2", "cf-connecting-ip": "3.3.3.3" }),
      socketIp: "203.0.113.5",
      onVercel: false,
    });
    expect(a).toBe(b);
  });

  it("on Vercel prefers x-vercel-forwarded-for, then x-real-ip, then x-forwarded-for", () => {
    const base = { socketIp: "10.0.0.1", onVercel: true };
    expect(
      resolveClientIp({
        ...base,
        headers: headers({
          "x-vercel-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
          "x-forwarded-for": "198.51.100.3",
        }),
      }),
    ).toBe("198.51.100.1");
    expect(
      resolveClientIp({
        ...base,
        headers: headers({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "198.51.100.3" }),
      }),
    ).toBe("198.51.100.2");
    expect(
      resolveClientIp({ ...base, headers: headers({ "x-forwarded-for": "198.51.100.3" }) }),
    ).toBe("198.51.100.3");
  });

  it("on Vercel takes the first address of a list", () => {
    expect(
      resolveClientIp({
        headers: headers({ "x-forwarded-for": "198.51.100.3, 10.1.1.1" }),
        socketIp: undefined,
        onVercel: true,
      }),
    ).toBe("198.51.100.3");
  });

  it("never reads cf-connecting-ip, even on Vercel", () => {
    expect(
      resolveClientIp({
        headers: headers({ "cf-connecting-ip": "198.51.100.77" }),
        socketIp: "203.0.113.5",
        onVercel: true,
      }),
    ).toBe("203.0.113.5");
  });

  it("falls back to the socket when a forwarded value is not an address", () => {
    expect(
      resolveClientIp({
        headers: headers({ "x-vercel-forwarded-for": "not-an-ip" }),
        socketIp: "203.0.113.5",
        onVercel: true,
      }),
    ).toBe("203.0.113.5");
  });

  it("uses a shared 'unknown' bucket when nothing is available", () => {
    expect(resolveClientIp({ headers: headers({}), socketIp: undefined, onVercel: false })).toBe(
      UNKNOWN_CLIENT,
    );
  });
});

describe("isOnVercel", () => {
  it("is true only when VERCEL is exactly 1", () => {
    expect(isOnVercel({ VERCEL: "1" })).toBe(true);
    expect(isOnVercel({ VERCEL: "true" })).toBe(false);
    expect(isOnVercel({})).toBe(false);
  });
});

describe("normalizeIp", () => {
  it("keeps IPv4 and strips a port", () => {
    expect(normalizeIp("203.0.113.5")).toBe("203.0.113.5");
    expect(normalizeIp("203.0.113.5:443")).toBe("203.0.113.5");
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("reduces IPv6 to its /64 network so one allocation is one bucket", () => {
    const a = normalizeIp("2001:db8:abcd:12:1:2:3:4");
    const b = normalizeIp("2001:db8:abcd:12:ffff:eeee:dddd:cccc");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(normalizeIp("2001:db8:abcd:13::1")).not.toBe(a);
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("rejects anything that is not an address", () => {
    for (const bad of [
      "",
      "garbage",
      "999.1.1.1",
      "1.2.3",
      "2001:db8::zz",
      "1.1.1.1; DROP TABLE",
    ]) {
      expect(normalizeIp(bad)).toBe(UNKNOWN_CLIENT);
    }
  });
});

describe("hashClientIp", () => {
  it("is stable, keyed, and fits the database subject format", async () => {
    const a = await hashClientIp("203.0.113.5", SALT);
    expect(a).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(await hashClientIp("203.0.113.5", SALT)).toBe(a);
    expect(await hashClientIp("203.0.113.6", SALT)).not.toBe(a);
    expect(await hashClientIp("203.0.113.5", `${SALT}x`)).not.toBe(a);
  });

  it("never contains the address", async () => {
    const hash = await hashClientIp("203.0.113.5", SALT);
    expect(hash).not.toContain("203");
    expect(hash).not.toContain("113");
  });

  it("refuses to hash without a salt", async () => {
    await expect(hashClientIp("203.0.113.5", "")).rejects.toThrow();
  });
});
