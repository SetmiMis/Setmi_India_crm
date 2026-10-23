import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { listEnquiries, type EnquiryFilters } from "@/server/queries";
import { toCsv } from "@/lib/domain/imports";
import { todayIST } from "@/lib/domain/dates";
import { serviceClient } from "@/lib/supabase/server";

// CSV export of the current Pipeline filters. Runs as the user (RLS), so a rep only ever
// exports their own leads. Formula injection is neutralised in toCsv(). Exports are audited.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const f: EnquiryFilters = Object.fromEntries(
    ["q", "stage", "source", "owner", "priority", "follow", "from", "to", "state", "city", "grade", "view", "sort"].map((k) => [k, p.get(k)?.slice(0, 100) || undefined]),
  );
  if (!user.isAdmin) {
    f.owner = undefined;
    f.view = undefined;
  }
  const rows: Awaited<ReturnType<typeof listEnquiries>>["rows"] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await listEnquiries(f, page, 500);
    rows.push(...r.rows);
    if (r.rows.length < 500) break;
  }
  const csv = toCsv(
    ["Enquiry ID", "Enquiry date", "Customer", "Company", "Phone", "City", "State", "Source", "Requirement", "Stage", "Priority", "Grade", "Next follow-up", "Last contact", "Est. value", "Quote amount", "Lead By"],
    rows.map((e) => [e.enq_code, e.enq_date, e.customer_name, e.company, e.phone, e.city, e.state, e.source, e.requirement, e.stage, e.priority ?? "", e.grade ?? "", e.next_follow_up ?? "", e.last_contact ?? "", e.est_value ?? "", e.quote_amount ?? "", e.owner?.name ?? ""]),
  );
  await serviceClient().rpc("audit_event", { p_actor: user.id, p_action: "export.enquiries", p_entity: "export", p_entity_id: "", p_details: { rows: rows.length } });
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="setmi-enquiries-${todayIST()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
