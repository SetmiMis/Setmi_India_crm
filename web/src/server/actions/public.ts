"use server";

import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimitStatus } from "@/server/rate-limit";
import { fieldErrors, publicEnquirySchema } from "@/lib/domain/validation";
import { fromDbError, invalid, type ActionResult } from "@/lib/errors";
import { fillLocationFromPincode } from "@/server/pincode";

/**
 * Public field-capture form (legacy submitFieldEnquiry). No login.
 * Defences: allow-listed fields (zod + database), honeypot, per-IP rate limits, idempotency
 * key (double submits/retries create one row), and the row can only land in Pending Approvals.
 * The legacy duplicate-phone lookup is NOT exposed publicly (it confirmed who is a customer).
 */
export async function submitPublicEnquiry(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = publicEnquirySchema.safeParse(raw);
  if (!parsed.success) {
    if (raw.website) return { ok: true, message: "Thank you! Your enquiry has been submitted." }; // honeypot: look successful
    return invalid("Please check the highlighted fields", fieldErrors(parsed.error));
  }
  const ip = await clientIp();
  const burst = await rateLimitStatus("public-enquiry", [ip], 5, 600);
  const daily = burst === "ok" ? await rateLimitStatus("public-enquiry-day", [ip], 25, 86400) : burst;
  if (burst === "unavailable" || daily === "unavailable") {
    return { ok: false, code: "unavailable", message: "We could not save your enquiry right now. Please try again shortly or call us." };
  }
  if (burst !== "ok" || daily !== "ok") return { ok: false, code: "rate_limited", message: "Too many submissions from this network. Please try again later or call us." };

  const { website: _hp, form_token, ...rest } = parsed.data;
  const p = await fillLocationFromPincode(rest);
  void _hp;
  const { error } = await serviceClient().rpc("submit_public_enquiry", {
    p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ""])),
    p_idempotency_key: form_token,
  });
  if (error) {
    const r = fromDbError(error);
    return r.code === "invalid" ? r : { ok: false, code: "unavailable", message: "We could not save your enquiry. Please try again." };
  }
  return { ok: true, message: "Thank you! Your enquiry has been submitted. Our team will contact you soon." };
}
