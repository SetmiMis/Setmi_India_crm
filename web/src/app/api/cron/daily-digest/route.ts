import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { runDailyDigest } from "@/server/jobs";

// Called by the scheduler (Hostinger cron / external) around 09:00 IST. Idempotent per day.
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDailyDigest());
}
