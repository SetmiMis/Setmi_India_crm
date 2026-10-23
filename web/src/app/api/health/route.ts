import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";

// Liveness + database reachability for uptime monitors. Reveals no versions, hosts or config.
export async function GET() {
  let db = "ok";
  try {
    const { error } = await serviceClient().from("lead_sources").select("name", { head: true, count: "exact" }).limit(1);
    if (error) db = "error";
  } catch {
    db = "error";
  }
  const res = NextResponse.json({ status: db === "ok" ? "ok" : "degraded", db, time: new Date().toISOString() }, { status: db === "ok" ? 200 : 503 });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
