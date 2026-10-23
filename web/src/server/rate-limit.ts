import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";

/** Client IP as seen by the reverse proxy (Hostinger / LiteSpeed set x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || "unknown";
}

function hashKey(parts: string[]): string {
  return createHash("sha256").update(`${env().RATE_LIMIT_SALT}|${parts.join("|")}`).digest("hex").slice(0, 40);
}

export type LimitStatus = "ok" | "limited" | "unavailable";

/**
 * Fixed-window limiter backed by Postgres (works across server instances). Raw IPs and
 * usernames are never stored — only salted hashes. If the database is unreachable the result is
 * "unavailable", which callers treat as a refusal (fail closed) with an honest message.
 */
export async function rateLimitStatus(scope: string, parts: string[], max: number, windowSeconds: number): Promise<LimitStatus> {
  try {
    const { data, error } = await serviceClient().rpc("rate_limit_hit", {
      p_bucket: `${scope}:${hashKey(parts)}`,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) throw error;
    return data === true ? "ok" : "limited";
  } catch (e) {
    logServerError("rate-limit", e);
    return "unavailable";
  }
}

export async function rateLimit(scope: string, parts: string[], max: number, windowSeconds: number): Promise<boolean> {
  return (await rateLimitStatus(scope, parts, max, windowSeconds)) === "ok";
}
