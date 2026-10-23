import "server-only";
import { userClient } from "@/lib/supabase/server";
import { todayIST, addDays } from "@/lib/domain/dates";
import { OPEN_STAGES, STAGES, type Stage } from "@/lib/domain/constants";

// Read queries for Server Components. All of them run AS THE USER, so RLS decides which rows
// come back — a rep can never widen the result by changing a filter or URL parameter.

export const PAGE_SIZE = 25;

export type EnquiryRow = {
  id: string;
  enq_code: string;
  enq_date: string;
  created_at: string;
  customer_name: string;
  company: string;
  phone: string;
  city: string;
  state: string;
  source: string;
  requirement: string;
  stage: Stage;
  priority: "Hot" | "Warm" | "Cold" | null;
  grade: "A" | "B" | "C" | null;
  next_follow_up: string | null;
  last_contact: string | null;
  est_value: number | null;
  quote_amount: number | null;
  owner_id: string | null;
  escalation: string | null;
  owner: { name: string } | null;
};

export type EnquiryFilters = {
  q?: string;
  stage?: string;
  source?: string;
  owner?: string;
  priority?: string;
  follow?: string;
  from?: string;
  to?: string;
  state?: string;
  city?: string;
  grade?: string;
  view?: string; // "deleted" | "archived" (admin)
  sort?: string;
};

/** Strip characters that have meaning in PostgREST filter syntax. */
export function safeSearch(q: string | undefined): string {
  return String(q ?? "")
    .replace(/[,()*\\%:"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

export async function listEnquiries(f: EnquiryFilters, page: number, pageSize = PAGE_SIZE) {
  const supabase = await userClient();
  let q = supabase
    .from("enquiries")
    .select(
      "id, enq_code, enq_date, created_at, customer_name, company, phone, city, state, source, requirement, stage, priority, grade, next_follow_up, last_contact, est_value, quote_amount, owner_id, escalation, owner:team_members(name)",
      { count: "exact" },
    );
  if (f.view === "deleted") q = q.eq("active", false);
  else if (f.view === "archived") q = q.eq("active", true).not("archived_at", "is", null);
  else q = q.eq("active", true).is("archived_at", null);

  const term = safeSearch(f.q);
  if (term) {
    const like = `%${term}%`;
    q = q.or(
      `customer_name.ilike.${like},company.ilike.${like},phone.ilike.${like},requirement.ilike.${like},city.ilike.${like},enq_code.ilike.${like}`,
    );
  }
  if (f.stage === "open") q = q.in("stage", OPEN_STAGES as string[]);
  else if (f.stage && (STAGES as readonly string[]).includes(f.stage)) q = q.eq("stage", f.stage);
  if (f.source) q = q.eq("source", f.source.slice(0, 40));
  if (f.owner === "unassigned") q = q.is("owner_id", null);
  else if (isUuid(f.owner)) q = q.eq("owner_id", f.owner!);
  if (f.priority && ["Hot", "Warm", "Cold"].includes(f.priority)) q = q.eq("priority", f.priority);
  if (f.grade && ["A", "B", "C"].includes(f.grade)) q = q.eq("grade", f.grade);
  if (isDate(f.from)) q = q.gte("enq_date", f.from!);
  if (isDate(f.to)) q = q.lte("enq_date", f.to!);
  if (f.state) q = q.ilike("state", `%${safeSearch(f.state)}%`);
  if (f.city) q = q.ilike("city", `%${safeSearch(f.city)}%`);
  const today = todayIST();
  if (f.follow === "overdue") q = q.in("stage", OPEN_STAGES as string[]).lt("next_follow_up", today);
  else if (f.follow === "today") q = q.in("stage", OPEN_STAGES as string[]).eq("next_follow_up", today);
  else if (f.follow === "upcoming") q = q.in("stage", OPEN_STAGES as string[]).gt("next_follow_up", today);
  else if (f.follow === "none") q = q.in("stage", OPEN_STAGES as string[]).is("next_follow_up", null);

  const sorts: Record<string, [string, boolean]> = {
    newest: ["created_at", false],
    oldest: ["created_at", true],
    followup: ["next_follow_up", true],
    value: ["est_value", false],
    customer: ["customer_name", true],
  };
  const [col, asc] = sorts[f.sort ?? "newest"] ?? sorts.newest;
  q = q.order(col, { ascending: asc, nullsFirst: false }).order("enq_code", { ascending: false });

  const fromIdx = (page - 1) * pageSize;
  const { data, count, error } = await q.range(fromIdx, fromIdx + pageSize - 1);
  if (error) throw new Error("Could not load enquiries");
  return { rows: (data ?? []) as unknown as EnquiryRow[], total: count ?? 0 };
}

export async function getEnquiry(id: string) {
  if (!isUuid(id)) return null;
  const supabase = await userClient();
  const { data: e } = await supabase
    .from("enquiries")
    .select("*, owner:team_members(name), customer:customers(id, cust_code)")
    .eq("id", id)
    .maybeSingle();
  if (!e) return null;
  const [fu, calls, hist, transfers, oms] = await Promise.all([
    supabase.from("follow_ups").select("id, fu_code, created_at, mode, outcome, next_follow_up, by_label, note").eq("enquiry_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("call_logs").select("id, call_code, call_number, call_date, employee_label, remarks, next_follow_up, call_status, interest").eq("enquiry_id", id).order("call_number", { ascending: true }),
    supabase.from("enquiry_stage_history").select("id, from_stage, to_stage, changed_at, note").eq("enquiry_id", id).order("changed_at", { ascending: true }),
    supabase.from("enquiry_transfers").select("id, status, proposed_at, from_member_id, to_member_id, to:team_members!enquiry_transfers_to_member_id_fkey(name), from:team_members!enquiry_transfers_from_member_id_fkey(name)").eq("enquiry_id", id).order("proposed_at", { ascending: false }),
    supabase.from("oms_order_requests").select("status, oms_order_id, error, created_at").eq("enquiry_id", id).order("created_at", { ascending: false }).limit(5),
  ]);
  return {
    enquiry: e as Record<string, unknown> & EnquiryRow & { version: number; active: boolean; archived_at: string | null; oms_order_id: string | null },
    followUps: fu.data ?? [],
    calls: calls.data ?? [],
    history: hist.data ?? [],
    transfers: (transfers.data ?? []) as unknown as Array<{ id: string; status: string; proposed_at: string; from_member_id: string | null; to_member_id: string; to: { name: string } | null; from: { name: string } | null }>,
    omsRequests: oms.data ?? [],
  };
}

export async function teamMembers(includeInactive = false) {
  const supabase = await userClient();
  let q = supabase.from("team_members").select("id, name, active, profile_id").order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return data ?? [];
}

export async function leadSources(): Promise<string[]> {
  const supabase = await userClient();
  const { data } = await supabase.from("lead_sources").select("name").eq("active", true).order("sort_order");
  return (data ?? []).map((s) => s.name);
}

export async function incomingTransfers(memberId: string | null) {
  if (!memberId) return [];
  const supabase = await userClient();
  const { data } = await supabase
    .from("enquiry_transfers")
    .select("id, proposed_at, enquiry:enquiries(id, enq_code, customer_name, company, requirement, stage), from:team_members!enquiry_transfers_from_member_id_fkey(name)")
    .eq("status", "Proposed")
    .eq("to_member_id", memberId)
    .order("proposed_at", { ascending: false });
  return (data ?? []) as unknown as Array<{
    id: string;
    proposed_at: string;
    enquiry: { id: string; enq_code: string; customer_name: string; company: string; requirement: string; stage: string } | null;
    from: { name: string } | null;
  }>;
}

export async function pendingList(page: number, q?: string, pageSize = PAGE_SIZE) {
  const supabase = await userClient();
  let query = supabase
    .from("pending_enquiries")
    .select("*, owner:team_members(name)", { count: "exact" })
    .eq("status", "Pending");
  const term = safeSearch(q);
  if (term) query = query.or(`customer_name.ilike.%${term}%,phone.ilike.%${term}%,company.ilike.%${term}%,requirement.ilike.%${term}%`);
  const from = (page - 1) * pageSize;
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  return { rows: (data ?? []) as Array<Record<string, unknown> & { id: string; pend_code: string; owner: { name: string } | null }>, total: count ?? 0 };
}

export async function recentReviewed(limit = 20) {
  const supabase = await userClient();
  const { data } = await supabase
    .from("pending_enquiries")
    .select("id, pend_code, customer_name, status, reviewed_by_label, reviewed_at, reject_reason, approved_enquiry_id")
    .neq("status", "Pending")
    .order("reviewed_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export function defaultDateRange(days = 90) {
  const to = todayIST();
  return { from: addDays(to, -days), to };
}
