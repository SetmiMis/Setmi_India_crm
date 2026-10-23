import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { callRpc } from "@/server/rpc";
import { toCsv } from "@/lib/domain/imports";
import { productLabel } from "@/lib/domain/products";
import { normalizeState } from "@/lib/domain/geo";
import { todayIST } from "@/lib/domain/dates";
import { serviceClient } from "@/lib/supabase/server";

// Legacy "Customers List": Won/Dispatched/Closed, one row per phone. Login required; reps get their own.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await callRpc<Array<{ customer_name: string; company: string; phone: string; requirement_head: string; state: string; city: string; enq_date: string; stage: string }>>("won_customers_list", {});
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 400 });
  const csv = toCsv(
    ["Customer", "Company", "Phone", "WhatsApp", "Product", "State", "City", "Enquiry date", "Stage"],
    r.data.map((c) => [c.customer_name, c.company, c.phone, `+91${c.phone}`, productLabel(c.requirement_head), normalizeState(c.state)?.name ?? c.state, c.city, c.enq_date, c.stage]),
  );
  await serviceClient().rpc("audit_event", { p_actor: user.id, p_action: "export.won_customers", p_entity: "export", p_entity_id: "", p_details: { rows: r.data.length } });
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="setmi-won-customers-${todayIST()}.csv"`, "Cache-Control": "no-store" },
  });
}
