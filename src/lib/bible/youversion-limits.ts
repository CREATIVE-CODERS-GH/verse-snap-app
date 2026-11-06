/**
 * A small in-memory sliding-window rate limiter that protects YOUVERSION_APP_KEY from excessive use.
 * Pure (no I/O, injectable clock) and free: no database, queue or paid service.
 *
 * Three guards, checked in this order:
 *  1. Per client: one reader cannot spend the whole allowance. Chapter navigation is one request per
 *     chapter, so the default (60 a minute) never gets in the way of normal reading.
 *  2. Cool-down: after YouVersion itself answers 429, no request is sent upstream until its
 *     Retry-After has passed (bounded), so a limit is never hammered. The reader and Discover share
 *     the one `youVersionLimiter` cool-down, because they share one app key and one upstream quota.
 *  3. Global: a ceiling on upstream calls per minute for this server instance.
 *
 * LIMITATIONS (also in docs/audit/YOUVERSION_YV1.md): state lives in the memory of ONE server
 * instance. On serverless hosting (Vercel) every instance has its own counters and a cold start
 * resets them, so the effective allowance is the limit times the number of live instances, and a
 * determined client could spread requests across instances. This is a cost and key-protection
 * guard against bursts and accidents, not a security boundary. A shared store (for example the
 * existing Postgres rate-limit tables) would be the next step if real traffic needs a hard cap.
 */

export interface LimiterOptions {
  perClient: number;
  perClientWindowMs: number;
  global: number;
  globalWindowMs: number;
  /** Upper bound on remembered clients; the least recently active are dropped first. */
  maxClients: number;
  /** Longest cool-down honoured after an upstream 429, in seconds. */
  maxCooldownSeconds: number;
  defaultCooldownSeconds: number;
  now?: () => number;
}

export const DEFAULT_LIMITS: LimiterOptions = {
  perClient: 60,
  perClientWindowMs: 60_000,
  global: 240,
  globalWindowMs: 60_000,
  maxClients: 5_000,
  // YouVersion has answered a burst with Retry-After: 300; honour up to five minutes.
  maxCooldownSeconds: 300,
  defaultCooldownSeconds: 30,
};

export type LimitDecision =
  { ok: true } | { ok: false; scope: "client" | "global" | "cooldown"; retryAfterSeconds: number };

export interface YouVersionLimiter {
  /** Counts one request from this client. */
  checkClient(clientId: string): LimitDecision;
  /** Counts one upstream call (only when a request is really about to be sent). */
  checkUpstream(): LimitDecision;
  /** Blocks upstream calls after YouVersion answered 429. `retryAfter` is the header value, if any. */
  coolDown(retryAfter: string | null): void;
  /** Seconds left of an upstream cool-down, or 0 when calls may go out. Does not count a request. */
  cooldownRemaining(): number;
}

function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function createYouVersionLimiter(
  overrides: Partial<LimiterOptions> = {},
): YouVersionLimiter {
  const options = { ...DEFAULT_LIMITS, ...overrides };
  const now = options.now ?? Date.now;
  const clients = new Map<string, number[]>();
  let upstream: number[] = [];
  let blockedUntil = 0;

  function recent(hits: number[], windowMs: number, at: number): number[] {
    const cutoff = at - windowMs;
    let start = 0;
    while (start < hits.length && (hits[start] as number) <= cutoff) start += 1;
    return start === 0 ? hits : hits.slice(start);
  }

  return {
    checkClient(clientId) {
      const at = now();
      const hits = recent(clients.get(clientId) ?? [], options.perClientWindowMs, at);
      if (hits.length >= options.perClient) {
        clients.set(clientId, hits);
        return {
          ok: false,
          scope: "client",
          retryAfterSeconds: seconds((hits[0] as number) + options.perClientWindowMs - at),
        };
      }
      hits.push(at);
      // Re-insert so the Map keeps least-recently-active clients first.
      clients.delete(clientId);
      clients.set(clientId, hits);
      while (clients.size > options.maxClients) {
        const oldest = clients.keys().next().value;
        if (oldest === undefined) break;
        clients.delete(oldest);
      }
      return { ok: true };
    },

    checkUpstream() {
      const at = now();
      if (at < blockedUntil) {
        return { ok: false, scope: "cooldown", retryAfterSeconds: seconds(blockedUntil - at) };
      }
      upstream = recent(upstream, options.globalWindowMs, at);
      if (upstream.length >= options.global) {
        return {
          ok: false,
          scope: "global",
          retryAfterSeconds: seconds((upstream[0] as number) + options.globalWindowMs - at),
        };
      }
      upstream.push(at);
      return { ok: true };
    },

    cooldownRemaining() {
      const left = blockedUntil - now();
      return left > 0 ? seconds(left) : 0;
    },

    coolDown(retryAfter) {
      const parsed = retryAfter === null ? NaN : Number.parseInt(retryAfter, 10);
      const wanted =
        Number.isFinite(parsed) && parsed > 0 ? parsed : options.defaultCooldownSeconds;
      const bounded = Math.min(wanted, options.maxCooldownSeconds);
      blockedUntil = Math.max(blockedUntil, now() + bounded * 1000);
    },
  };
}

export const youVersionLimiter: YouVersionLimiter = createYouVersionLimiter();
