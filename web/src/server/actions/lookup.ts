"use server";

import { getCurrentUser } from "@/server/auth";
import { clientIp, rateLimit } from "@/server/rate-limit";

export type PincodeInfo = { found: boolean; district?: string; state?: string; areas?: string[] };

/**
 * Pincode → district/state/post offices via api.postalpincode.in (the legacy app called it from
 * the browser). Proxied server-side: fixed host, digits-only input (no SSRF), short timeout,
 * response cached by Next for a day. Signed-in users only, rate-limited.
 */
export async function lookupPincode(pin: string, publicForm = false): Promise<PincodeInfo> {
  if (!/^\d{6}$/.test(pin)) return { found: false };
  if (!publicForm && !(await getCurrentUser())) return { found: false };
  if (!(await rateLimit("pincode", [await clientIp()], 60, 600))) return { found: false };
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { found: false };
    const data = (await res.json()) as Array<{ Status: string; PostOffice?: Array<{ Name: string; District: string; State: string }> }>;
    const po = data?.[0]?.Status === "Success" ? data[0].PostOffice ?? [] : [];
    if (!po.length) return { found: false };
    return {
      found: true,
      district: String(po[0].District ?? "").slice(0, 80),
      state: String(po[0].State ?? "").slice(0, 80),
      areas: po.slice(0, 30).map((p) => String(p.Name).slice(0, 80)),
    };
  } catch {
    return { found: false };
  }
}
