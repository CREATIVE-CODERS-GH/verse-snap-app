import { describe, expect, it, vi } from "vitest";
import { resolveIdentity, type Claims } from "./identity.server";

const SALT = "unit-test-salt-0123456789abcdef0123456789";
const USER_ID = "3f2a9c1e-5b7d-4c8a-9e10-abcdef012345";
const TOKEN = "aaaa.bbbb.cccc";

function input(over: Partial<Parameters<typeof resolveIdentity>[0]> = {}) {
  return {
    headers: new Headers(),
    socketIp: "203.0.113.5",
    onVercel: false,
    authorization: null,
    salt: SALT,
    verifyToken: vi.fn(async (): Promise<Claims | null> => null),
    ...over,
  };
}

describe("resolveIdentity", () => {
  it("returns the verified user for a valid access token", async () => {
    const verifyToken = vi.fn(async () => ({ sub: USER_ID, role: "authenticated" }));
    const identity = await resolveIdentity(
      input({ authorization: `Bearer ${TOKEN}`, verifyToken }),
    );
    expect(identity).toEqual({ subject: `user:${USER_ID}`, kind: "user" });
    expect(verifyToken).toHaveBeenCalledWith(TOKEN);
  });

  it("treats an invalid or expired token as a guest, not an error", async () => {
    const identity = await resolveIdentity(
      input({ authorization: `Bearer ${TOKEN}`, verifyToken: vi.fn(async () => null) }),
    );
    expect(identity.kind).toBe("guest");
    expect(identity.subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("treats a verifier that throws as a guest", async () => {
    const identity = await resolveIdentity(
      input({
        authorization: `Bearer ${TOKEN}`,
        verifyToken: vi.fn(async () => {
          throw new Error("auth server down");
        }),
      }),
    );
    expect(identity.kind).toBe("guest");
  });

  it("does not accept the anonymous (publishable key) role or a non-UUID subject", async () => {
    for (const claims of [
      { sub: USER_ID, role: "anon" },
      { sub: "not-a-uuid", role: "authenticated" },
      { role: "authenticated" },
      { sub: "user:evil", role: "authenticated" },
    ]) {
      const identity = await resolveIdentity(
        input({ authorization: `Bearer ${TOKEN}`, verifyToken: vi.fn(async () => claims) }),
      );
      expect(identity.kind).toBe("guest");
    }
  });

  it("does not call the verifier for missing or malformed authorization", async () => {
    for (const authorization of [
      null,
      "",
      "Basic abc",
      "Bearer",
      "Bearer a.b",
      "Bearer a b c",
      `bearer ${TOKEN}`,
    ]) {
      const verifyToken = vi.fn(async () => ({ sub: USER_ID, role: "authenticated" }));
      const identity = await resolveIdentity(input({ authorization, verifyToken }));
      expect(identity.kind).toBe("guest");
      expect(verifyToken).not.toHaveBeenCalled();
    }
  });

  it("keys guests by a salted hash of the socket address, not the address itself", async () => {
    const identity = await resolveIdentity(input());
    expect(identity.kind).toBe("guest");
    expect(identity.subject).not.toContain("203.0.113.5");
  });

  it("gives a local caller the same guest bucket whatever forwarding headers they send", async () => {
    const a = await resolveIdentity(
      input({
        headers: new Headers({ "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "9.9.9.9" }),
      }),
    );
    const b = await resolveIdentity(
      input({ headers: new Headers({ "x-forwarded-for": "2.2.2.2" }) }),
    );
    expect(a.subject).toBe(b.subject);
  });

  it("uses the Vercel-provided address only when running on Vercel", async () => {
    const forwarded = new Headers({ "x-vercel-forwarded-for": "198.51.100.20" });
    const onVercel = await resolveIdentity(input({ headers: forwarded, onVercel: true }));
    const local = await resolveIdentity(input({ headers: forwarded, onVercel: false }));
    expect(onVercel.subject).not.toBe(local.subject);
    const sameAsDirect = await resolveIdentity(
      input({ headers: new Headers(), socketIp: "198.51.100.20", onVercel: false }),
    );
    expect(onVercel.subject).toBe(sameAsDirect.subject);
  });

  it("throws (so the request fails closed) when the salt is missing", async () => {
    await expect(resolveIdentity(input({ salt: "" }))).rejects.toThrow();
  });
});
