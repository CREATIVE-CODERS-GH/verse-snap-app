import { createClient } from "@supabase/supabase-js";
import { hashClientIp, resolveClientIp, type ClientIpInput } from "./client-ip.server";

/**
 * Decides whose quota a request counts against.
 * - A valid Supabase access token (verified on the server) -> "user:<uuid>".
 * - Anything else (no token, malformed, expired, anonymous-role) -> a guest, keyed by a salted hash
 *   of the client address. An invalid token is treated as a guest, never as an error.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Claims {
  sub?: string;
  role?: string;
}

/** Returns verified claims for an access token, or null when it is not valid. */
export type TokenVerifier = (token: string) => Promise<Claims | null>;

export interface Identity {
  subject: string;
  kind: "user" | "guest";
}

export interface IdentityInput extends ClientIpInput {
  authorization: string | null;
  salt: string;
  verifyToken: TokenVerifier;
}

export async function resolveIdentity(input: IdentityInput): Promise<Identity> {
  const token = bearerToken(input.authorization);
  if (token) {
    try {
      const claims = await input.verifyToken(token);
      if (claims?.sub && claims.role === "authenticated" && UUID.test(claims.sub)) {
        return { subject: `user:${claims.sub}`, kind: "user" };
      }
    } catch {
      /* verification trouble -> treat as a guest */
    }
  }
  const ip = resolveClientIp(input);
  return { subject: await hashClientIp(ip, input.salt), kind: "guest" };
}

function bearerToken(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header ?? "");
  const token = match?.[1];
  return token && token.split(".").length === 3 ? token : null;
}

/** Production verifier: checks the token with the project's Supabase auth (publishable key only). */
export function createSupabaseTokenVerifier(
  env: Record<string, string | undefined> = process.env,
): TokenVerifier {
  return async (token) => {
    const url = env["SUPABASE_URL"] ?? env["VITE_SUPABASE_URL"];
    const key =
      env["SUPABASE_PUBLISHABLE_KEY"] ??
      env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
      (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined);
    if (!url || !key) return null;
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims) return null;
    const claims = data.claims as Claims;
    return {
      ...(claims.sub ? { sub: claims.sub } : {}),
      ...(claims.role ? { role: claims.role } : {}),
    };
  };
}
