import "server-only";

/** Server-side fill of missing district/state from the pincode (no auth/rate checks: callers are already authorized). */
export async function fillLocationFromPincode<T extends { pincode?: string; district?: string; state?: string }>(p: T): Promise<T> {
  if (!p.pincode || !/^\d{6}$/.test(p.pincode) || (p.district && p.state)) return p;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${p.pincode}`, { signal: AbortSignal.timeout(4000), next: { revalidate: 86400 } });
    const data = (await res.json()) as Array<{ Status: string; PostOffice?: Array<{ District: string; State: string }> }>;
    const po = data?.[0]?.Status === "Success" ? data[0].PostOffice?.[0] : undefined;
    if (!po) return p;
    return { ...p, district: p.district || String(po.District).slice(0, 80), state: p.state || String(po.State).slice(0, 80) };
  } catch {
    return p;
  }
}
