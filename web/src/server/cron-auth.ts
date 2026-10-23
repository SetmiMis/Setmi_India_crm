import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Constant-time check of "Authorization: Bearer <CRON_SECRET>". Disabled when CRON_SECRET is unset. */
export function cronAuthorized(header: string | null): boolean {
  const secret = env().CRON_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
