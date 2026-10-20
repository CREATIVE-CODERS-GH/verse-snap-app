import { isIP } from "node:net";

/**
 * Works out which client address to rate-limit, trusting only what the platform can vouch for.
 *
 * - On Vercel (VERCEL=1) the platform overwrites x-forwarded-for / x-vercel-forwarded-for with the
 *   real client address and does not forward external values, so those headers are trustworthy there.
 * - Anywhere else (local development, an unknown host) NO forwarding header is trusted: a caller can
 *   set them freely. The socket peer address is used instead.
 * - cf-connecting-ip is never read: Vercel does not set it, so a caller could choose their own bucket.
 */

export interface ClientIpInput {
  headers: { get(name: string): string | null };
  /** The address of the TCP peer, from the server runtime (never from a header). */
  socketIp: string | undefined;
  onVercel: boolean;
}

/** Bucket used when no usable address is available: shared and therefore strict. */
export const UNKNOWN_CLIENT = "unknown";

function firstValid(value: string | null): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim();
  return first && normalizeIp(first) !== UNKNOWN_CLIENT ? first : undefined;
}

export function isOnVercel(env: Record<string, string | undefined> = process.env): boolean {
  return env["VERCEL"] === "1";
}

export function resolveClientIp({ headers, socketIp, onVercel }: ClientIpInput): string {
  if (onVercel) {
    const forwarded =
      firstValid(headers.get("x-vercel-forwarded-for")) ??
      firstValid(headers.get("x-real-ip")) ??
      firstValid(headers.get("x-forwarded-for"));
    if (forwarded) return normalizeIp(forwarded);
  }
  return socketIp ? normalizeIp(socketIp) : UNKNOWN_CLIENT;
}

function expandIpv6(address: string): number[] | null {
  let text = address;
  // Embedded IPv4 tail (for example ::ffff:1.2.3.4) becomes two hextets.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail?.[1]) {
    const parts = tail[1].split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => part > 255)) return null;
    const hi = (((parts[0] ?? 0) << 8) | (parts[1] ?? 0)).toString(16);
    const lo = (((parts[2] ?? 0) << 8) | (parts[3] ?? 0)).toString(16);
    text = text.slice(0, text.length - tail[1].length) + `${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (missing < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => parseInt(group || "0", 16));
  return numbers.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff) ? null : numbers;
}

/**
 * Canonical text for an address: IPv4 as-is (IPv4-mapped IPv6 unwrapped), IPv6 reduced to its
 * /64 network so rotating through a single allocation does not yield free new buckets.
 */
export function normalizeIp(raw: string): string {
  let value = raw.trim().replace(/^\[|\]$/g, "");
  value = value.replace(/%.*$/, ""); // zone id
  // "1.2.3.4:5678" -> "1.2.3.4"
  const withPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(value);
  if (withPort?.[1]) value = withPort[1];

  const kind = isIP(value);
  if (kind === 4) return value;
  if (kind !== 6) return UNKNOWN_CLIENT;

  const groups = expandIpv6(value.toLowerCase());
  if (!groups) return UNKNOWN_CLIENT;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** Stable, non-reversible subject for a client address: HMAC-SHA256 truncated to 128 bits. */
export async function hashClientIp(ip: string, salt: string): Promise<string> {
  if (!salt) throw new Error("rate limit salt is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ip:${hex.slice(0, 32)}`;
}
