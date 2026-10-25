import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "./config.server";
import { consumeQuota, type ConsumeRpc } from "./quota.server";

const guest = { subject: `ip:${"a".repeat(32)}`, kind: "guest" as const };
const user = { subject: "user:3f2a9c1e-5b7d-4c8a-9e10-abcdef012345", kind: "user" as const };

const allowed: ConsumeRpc = async () => ({
  data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
  error: null,
});

describe("consumeQuota", () => {
  it("allows when the database says allowed", async () => {
    expect(await consumeQuota(guest, DEFAULT_LIMITS, allowed)).toEqual({ allowed: true });
  });

  it("sends the guest limits for guests and the user limits for signed-in users", async () => {
    const rpc = vi.fn(allowed);
    await consumeQuota(guest, DEFAULT_LIMITS, rpc);
    await consumeQuota(user, DEFAULT_LIMITS, rpc);
    expect(rpc).toHaveBeenNthCalledWith(1, {
      p_subject: guest.subject,
      p_minute_limit: 3,
      p_day_limit: 15,
      p_global_day_limit: 300,
      p_global_month_limit: 5000,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, {
      p_subject: user.subject,
      p_minute_limit: 6,
      p_day_limit: 60,
      p_global_day_limit: 300,
      p_global_month_limit: 5000,
    });
  });

  it("reports each denial reason with its retry time", async () => {
    for (const reason of ["minute", "day", "global_day", "global_month"] as const) {
      const rpc: ConsumeRpc = async () => ({
        data: [{ allowed: false, reason, retry_after_seconds: 42 }],
        error: null,
      });
      expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toEqual({
        allowed: false,
        reason,
        retryAfterSeconds: 42,
      });
    }
  });

  it("accepts a single object as well as an array row", async () => {
    const rpc: ConsumeRpc = async () => ({
      data: { allowed: false, reason: "minute", retry_after_seconds: 7 },
      error: null,
    });
    expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toMatchObject({
      allowed: false,
      reason: "minute",
    });
  });

  it("falls back to 60 seconds when the retry time is missing or nonsense", async () => {
    for (const retry of [undefined, null, 0, -5, "soon"]) {
      const rpc: ConsumeRpc = async () => ({
        data: [{ allowed: false, reason: "minute", retry_after_seconds: retry }],
        error: null,
      });
      expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toMatchObject({
        retryAfterSeconds: 60,
      });
    }
  });

  describe("fails closed", () => {
    const denied = { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };

    it("on a database error", async () => {
      const rpc: ConsumeRpc = async () => ({ data: null, error: { message: "boom" } });
      expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toEqual(denied);
    });

    it("when the call throws", async () => {
      const rpc: ConsumeRpc = async () => {
        throw new Error("network down");
      };
      expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toEqual(denied);
    });

    it("on malformed or empty results", async () => {
      for (const data of [
        null,
        undefined,
        [],
        {},
        [{}],
        "yes",
        [{ allowed: "true" }],
        [{ allowed: 1 }],
      ]) {
        const rpc: ConsumeRpc = async () => ({ data, error: null });
        expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toEqual(denied);
      }
    });

    it("on a denial with an unknown reason", async () => {
      const rpc: ConsumeRpc = async () => ({
        data: [{ allowed: false, reason: "something-new", retry_after_seconds: 5 }],
        error: null,
      });
      expect(await consumeQuota(guest, DEFAULT_LIMITS, rpc)).toEqual(denied);
    });
  });
});
