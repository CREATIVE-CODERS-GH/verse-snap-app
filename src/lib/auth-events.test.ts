import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AI_SEARCH_QUERY_KEY } from "./bible/ai/search-query";
import { invalidateUserQueries, planAuthEvent } from "./auth-events";

describe("planAuthEvent", () => {
  it("only records the user on INITIAL_SESSION", () => {
    expect(planAuthEvent("INITIAL_SESSION", "u1", null)).toEqual({
      invalidateRouter: false,
      invalidateQueries: false,
      userId: "u1",
    });
  });

  it("refreshes data on a real sign-in", () => {
    expect(planAuthEvent("SIGNED_IN", "u1", null)).toMatchObject({
      invalidateRouter: true,
      invalidateQueries: true,
      userId: "u1",
    });
    expect(planAuthEvent("SIGNED_IN", "u2", "u1")).toMatchObject({
      invalidateQueries: true,
      userId: "u2",
    });
  });

  it("does nothing when SIGNED_IN repeats for the same person (tab regained focus)", () => {
    expect(planAuthEvent("SIGNED_IN", "u1", "u1")).toEqual({
      invalidateRouter: false,
      invalidateQueries: false,
      userId: "u1",
    });
  });

  it("refreshes on a profile update and clears on sign-out", () => {
    expect(planAuthEvent("USER_UPDATED", "u1", "u1")).toMatchObject({
      invalidateRouter: true,
      invalidateQueries: true,
    });
    expect(planAuthEvent("SIGNED_OUT", null, "u1")).toEqual({
      invalidateRouter: true,
      invalidateQueries: false,
      userId: null,
    });
  });

  it("ignores token refreshes and unknown events", () => {
    for (const event of [
      "TOKEN_REFRESHED",
      "PASSWORD_RECOVERY",
      "MFA_CHALLENGE_VERIFIED",
      "whatever",
    ]) {
      expect(planAuthEvent(event, "u1", "u1")).toEqual({
        invalidateRouter: false,
        invalidateQueries: false,
        userId: "u1",
      });
    }
  });
});

describe("invalidateUserQueries", () => {
  it("refreshes saved verses, history and other data but never the paid AI search", async () => {
    const client = new QueryClient();
    const calls = { saved: 0, history: 0, search: 0 };
    // Observers make the queries "active", exactly as mounted components do.
    const watch = (key: readonly unknown[], name: keyof typeof calls) =>
      new QueryObserver(client, {
        queryKey: key,
        queryFn: async () => ++calls[name],
        staleTime: Infinity,
      }).subscribe(() => undefined);
    const stop = [
      watch(["saved", "is", "u1"], "saved"),
      watch(["history"], "history"),
      watch([AI_SEARCH_QUERY_KEY, "love is patient", "KJAV"], "search"),
    ];
    await vi.waitFor(() => expect(calls.saved + calls.history + calls.search).toBe(3));
    await vi.waitFor(() => expect(client.isFetching()).toBe(0)); // first loads fully settled

    await invalidateUserQueries(client);
    await vi.waitFor(() => expect([calls.saved, calls.history]).toEqual([2, 2]));
    expect(calls.search).toBe(1); // untouched: no second paid request
    stop.forEach((unsubscribe) => unsubscribe());
  });
});
