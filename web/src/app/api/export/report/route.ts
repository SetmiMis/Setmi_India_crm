import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { callRpc } from "@/server/rpc";
import { toCsv } from "@/lib/domain/imports";
import { todayIST } from "@/lib/domain/dates";

// Admin report download (replaces the legacy "Report Mon yyyy" sheet generator).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const r = await callRpc<{ sources: Array<Record<string, unknown>>; owners: Array<Record<string, unknown>> }>("reports_summary", {
    p_date_from: isDate(from), p_date_to: isDate(to),
  });
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 400 });
  const csv =
    toCsv(["Source", "Enquiries", "Won", "Lost", "Win %"], r.data.sources.map((s) => [s.source, s.enquiries, s.won, s.lost, s.win_rate])) +
    "\r\n" +
    toCsv(["Lead By", "Enquiries", "Won", "Lost"], r.data.owners.map((o) => [o.owner, o.enquiries, o.won, o.lost]));
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="setmi-report-${todayIST()}.csv"`, "Cache-Control": "no-store" },
  });
}
