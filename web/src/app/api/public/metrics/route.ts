import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { normalizeState } from "@/lib/domain/geo";
import { logServerError } from "@/lib/errors";

// Counts-only metrics feed for the public website (legacy ?page=metrics&key=…).
// Key: "Authorization: Bearer <key>" (preferred) or ?key= for backwards compatibility.
// Never returns names, phones, values, rep names, win/loss, overdue or backlog.

const ALLOWED_ORIGIN = process.env.PUBLIC_METRICS_ORIGIN ?? "";

function json(body: unknown, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "private, max-age=300");
  if (ALLOWED_ORIGIN) {
    res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  if (ALLOWED_ORIGIN) {
    res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.headers.set("Access-Control-Allow-Methods", "GET");
    res.headers.set("Access-Control-Allow-Headers", "Authorization");
    res.headers.set("Access-Control-Max-Age", "86400");
  }
  return res;
}

export async function GET(request: NextRequest) {
  if (!(await rateLimit("metrics", [await clientIp()], 120, 3600))) return json({ error: "rate limited" }, 429);
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : request.nextUrl.searchParams.get("key") ?? "";
  if (key.length < 20 || key.length > 200) return json({ error: "invalid key" }, 401);
  const svc = serviceClient();
  const { data: ok } = await svc.rpc("verify_metrics_key", { p_key_hash: createHash("sha256").update(key).digest("hex") });
  if (ok !== true) return json({ error: "invalid key" }, 401);
  const { data, error } = await svc.rpc("public_metrics");
  if (error) {
    logServerError("metrics", error);
    return json({ error: "unavailable" }, 503);
  }
  const m = data as Record<string, unknown> & { states: Array<{ state: string; count: number }> };
  const states = new Map<string, { state: string; iso: string; count: number }>();
  for (const s of m.states) {
    const n = normalizeState(s.state);
    if (!n) continue;
    const cur = states.get(n.iso) ?? { state: n.name, iso: n.iso, count: 0 };
    cur.count += Number(s.count);
    states.set(n.iso, cur);
  }
  return json({ ...m, states: [...states.values()].sort((a, b) => b.count - a.count) });
}
