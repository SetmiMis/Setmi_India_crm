import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/server/cron-auth";
import { runMetaSheetImport } from "@/server/jobs";

// Called by the scheduler every 30 minutes (legacy trigger interval). Dedup makes reruns safe.
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runMetaSheetImport(null));
}
