import { COMPANY } from "./constants";

type Lead = {
  customer_name?: string | null;
  phone?: string | null;
  owner_name?: string | null;
  requirement?: string | null;
  quote_no?: string | null;
  quote_amount?: number | string | null;
};

/** Legacy waNum_: 10-digit numbers get the 91 country code. */
export function waNumber(phone: string | null | undefined): string {
  let p = String(phone ?? "").replace(/\D/g, "");
  if (p.length === 10) p = `91${p}`;
  return p;
}

export function welcomeMessage(e: Lead): string {
  let m = `Namaste ${e.customer_name ?? ""} 🙏\n\nThank you for connecting with *${COMPANY.name}*.`;
  if (e.owner_name) m += `\nYou were attended by *${e.owner_name}*`;
  if (e.requirement) m += `${e.owner_name ? " " : "\n"}regarding your requirement: *${e.requirement}*`;
  m += ".\n\nWe will share the details/quotation shortly. For anything, simply reply here.\n\n";
  m += `— ${COMPANY.name}\n_${COMPANY.tagline}_`;
  return m;
}

export function followUpMessage(e: Lead): string {
  let m = `Hello ${e.customer_name ?? ""},\n\nFollowing up from *${COMPANY.name}*`;
  if (e.owner_name) m += ` (attended by ${e.owner_name})`;
  m += ".";
  if (e.quote_no) m += `\nRef quotation *${e.quote_no}*${e.quote_amount ? ` for ₹${e.quote_amount}` : ""}.`;
  if (e.requirement) m += `\nRe: ${e.requirement}.`;
  m += `\n\nMay we know your decision so we can serve you better?\n\n— ${COMPANY.name}`;
  return m;
}

export function waLink(e: Lead, kind: "welcome" | "follow"): string | null {
  const n = waNumber(e.phone);
  if (n.length < 10) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(kind === "welcome" ? welcomeMessage(e) : followUpMessage(e))}`;
}
