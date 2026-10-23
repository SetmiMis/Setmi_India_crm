// Load transformed legacy data into Postgres. Idempotent: every insert is keyed by the legacy
// business code with ON CONFLICT DO NOTHING, so re-running after a partial failure only adds
// what is missing. The caller wraps this in ONE transaction (all or nothing).
import type { Transformed } from "./transform";

export type Executor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

const BATCH = 500;
async function batched<T>(rows: T[], fn: (chunk: T[]) => Promise<number>): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) n += await fn(rows.slice(i, i + BATCH));
  return n;
}
const json = (v: unknown) => JSON.stringify(v);
const inserted = (r: { rows: Array<Record<string, unknown>> }) => Number(r.rows[0]?.n ?? 0);

function legacyNote(notes: unknown, url: unknown): string {
  const n = String(notes ?? "");
  const u = String(url ?? "").trim();
  return u ? `${n}${n ? " | " : ""}Legacy document: ${u}` : n;
}

export async function applyMigration(db: Executor, t: Transformed) {
  const counts: Record<string, number> = {};

  counts.team_members = await batched(t.team, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.team_members (name, active)
         select x.name, x.active from jsonb_to_recordset($1::jsonb) as x(name text, active boolean)
         on conflict ((lower(btrim(name)))) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  counts.customers = await batched(t.customers, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.customers (cust_code, created_at, name, company, phone, email, gst, pincode, district, state, city, source, notes, active)
         select x.cust_code, coalesce(x.created_at, now()), coalesce(x.name,''), coalesce(x.company,''), coalesce(x.phone,''), coalesce(x.email,''),
                coalesce(x.gst,''), coalesce(x.pincode,''), coalesce(x.district,''), coalesce(x.state,''), coalesce(x.city,''), coalesce(x.source,''),
                coalesce(x.notes,''), x.active
           from jsonb_to_recordset($1::jsonb) as x(cust_code text, created_at timestamptz, name text, company text, phone text, email text, gst text,
                pincode text, district text, state text, city text, source text, notes text, active boolean)
         on conflict (cust_code) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  const enq = t.enquiries.map((e) => ({ ...e, notes: legacyNote(e.notes, e.legacy_photo_url) }));
  counts.enquiries = await batched(enq, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.enquiries (enq_code, created_at, enq_date, customer_id, customer_name, company, phone, email, gst, pincode, district,
           state, city, source, requirement, est_value, stage, priority, owner_id, claimed_at, quote_no, quote_amount, quote_date, next_follow_up,
           last_contact, order_value, lost_reason, dispatch_date, dispatch_info, shipment_weight, feedback_rating, feedback_note, notes, active,
           archived_at, qty, timeline, grade, escalation, invoice_no, oms_order_id)
         select x.enq_code, coalesce(x.created_at, now()), coalesce(x.enq_date, (now() at time zone 'Asia/Kolkata')::date),
                (select c.id from public.customers c where c.cust_code = x.customer_code),
                x.customer_name, coalesce(x.company,''), coalesce(x.phone,''), coalesce(x.email,''), coalesce(x.gst,''), coalesce(x.pincode,''),
                coalesce(x.district,''), coalesce(x.state,''), coalesce(x.city,''), x.source, coalesce(x.requirement,''), x.est_value, x.stage, x.priority,
                (select t.id from public.team_members t where lower(btrim(t.name)) = lower(btrim(x.owner_name))),
                x.claimed_at, coalesce(x.quote_no,''), x.quote_amount, x.quote_date, x.next_follow_up, x.last_contact, x.order_value,
                coalesce(x.lost_reason,''), x.dispatch_date, coalesce(x.dispatch_info,''), x.shipment_weight, x.feedback_rating,
                coalesce(x.feedback_note,''), coalesce(x.notes,''), x.active, case when x.archived then now() end, x.qty, x.timeline,
                private.grade_for(x.qty, x.timeline), x.escalation, coalesce(x.invoice_no,''), x.oms_order_id
           from jsonb_to_recordset($1::jsonb) as x(enq_code text, created_at timestamptz, enq_date date, customer_code text, customer_name text,
                company text, phone text, email text, gst text, pincode text, district text, state text, city text, source text, requirement text,
                est_value numeric, stage text, priority text, owner_name text, claimed_at timestamptz, quote_no text, quote_amount numeric,
                quote_date date, next_follow_up date, last_contact date, order_value numeric, lost_reason text, dispatch_date date,
                dispatch_info text, shipment_weight numeric, feedback_rating smallint, feedback_note text, notes text, active boolean,
                archived boolean, qty numeric, timeline text, escalation text, invoice_no text, oms_order_id text)
         on conflict (enq_code) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  // Pending transfers recorded in the legacy TransferTo column.
  const transfers = t.enquiries.filter((e) => e.transfer_to_name).map((e) => ({ enq_code: e.enq_code, to_name: e.transfer_to_name }));
  counts.enquiry_transfers = await batched(transfers, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.enquiry_transfers (enquiry_id, from_member_id, to_member_id)
         select e.id, e.owner_id, t.id from jsonb_to_recordset($1::jsonb) as x(enq_code text, to_name text)
           join public.enquiries e on e.enq_code = x.enq_code
           join public.team_members t on lower(btrim(t.name)) = lower(btrim(x.to_name))
          where t.id is distinct from e.owner_id
            and not exists (select 1 from public.enquiry_transfers o where o.enquiry_id = e.id and o.status = 'Proposed')
         returning 1) select count(*)::int n from ins`, [json(c)])));

  const pend = t.pending.map((p) => ({ ...p, notes: legacyNote(p.notes, p.legacy_photo_url) }));
  counts.pending_enquiries = await batched(pend, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.pending_enquiries (pend_code, created_at, submitted_via, submitted_by_label, customer_name, company, phone, email,
           gst, pincode, district, state, city, source, priority, owner_id, est_value, requirement, qty, timeline, notes, status,
           approved_enquiry_id, reviewed_by_label, reviewed_at, reject_reason)
         select x.pend_code, coalesce(x.created_at, now()), x.submitted_via, coalesce(x.submitted_by_label,''), x.customer_name, coalesce(x.company,''),
                coalesce(x.phone,''), coalesce(x.email,''), coalesce(x.gst,''), coalesce(x.pincode,''), coalesce(x.district,''), coalesce(x.state,''),
                coalesce(x.city,''), x.source, x.priority,
                (select t.id from public.team_members t where lower(btrim(t.name)) = lower(btrim(x.owner_name))),
                x.est_value, coalesce(x.requirement,''), x.qty, x.timeline, coalesce(x.notes,''), x.status,
                (select e.id from public.enquiries e where e.enq_code = x.approved_enq_code),
                coalesce(x.reviewed_by_label,''), x.reviewed_at, coalesce(x.reject_reason,'')
           from jsonb_to_recordset($1::jsonb) as x(pend_code text, created_at timestamptz, submitted_via text, submitted_by_label text, customer_name text,
                company text, phone text, email text, gst text, pincode text, district text, state text, city text, source text, priority text,
                owner_name text, est_value numeric, requirement text, qty numeric, timeline text, notes text, status text, approved_enq_code text,
                reviewed_by_label text, reviewed_at timestamptz, reject_reason text)
         on conflict (pend_code) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  counts.follow_ups = await batched(t.followUps, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.follow_ups (fu_code, created_at, enquiry_id, customer_name, mode, outcome, next_follow_up, by_member_id, by_label, note)
         select x.fu_code, coalesce(x.created_at, now()), e.id, coalesce(x.customer_name,''), x.mode, coalesce(x.outcome,''), x.next_follow_up,
                (select t.id from public.team_members t where lower(btrim(t.name)) = lower(btrim(x.by_name))), coalesce(x.by_label,''), coalesce(x.note,'')
           from jsonb_to_recordset($1::jsonb) as x(fu_code text, created_at timestamptz, enq_code text, customer_name text, mode text, outcome text,
                next_follow_up date, by_name text, by_label text, note text)
           join public.enquiries e on e.enq_code = x.enq_code
         on conflict (fu_code) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  counts.call_logs = await batched(t.calls, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.call_logs (call_code, created_at, enquiry_id, customer_name, call_number, call_date, employee_member_id,
           employee_label, remarks, next_follow_up, call_status, interest)
         select x.call_code, coalesce(x.created_at, now()), e.id, coalesce(x.customer_name,''), x.call_number, x.call_date,
                (select t.id from public.team_members t where lower(btrim(t.name)) = lower(btrim(x.employee_name))),
                coalesce(x.employee_label,''), coalesce(x.remarks,''), x.next_follow_up, x.call_status, x.interest
           from jsonb_to_recordset($1::jsonb) as x(call_code text, created_at timestamptz, enq_code text, customer_name text, call_number int,
                call_date date, employee_name text, employee_label text, remarks text, next_follow_up date, call_status text, interest text)
           join public.enquiries e on e.enq_code = x.enq_code
         on conflict do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  counts.external_lead_refs = await batched(t.metaRefs, async (c) =>
    inserted(await db.query(
      `with ins as (insert into public.external_lead_refs (source, external_id, enquiry_id)
         select 'meta', x.external_id, e.id from jsonb_to_recordset($1::jsonb) as x(external_id text, enq_code text)
           join public.enquiries e on e.enq_code = x.enq_code
         on conflict (source, external_id) do nothing returning 1) select count(*)::int n from ins`, [json(c)])));

  for (const [prefix, max] of Object.entries(t.counters)) {
    await db.query(`update private.id_counters set last_value = greatest(last_value, $2) where prefix = $1`, [prefix, max]);
  }
  await db.query(
    `insert into private.audit_log (actor_label, action, entity, entity_id, details) values ('migration', 'migration.apply', 'migration', '', $1::jsonb)`,
    [json(counts)],
  );
  return counts;
}

/** Target-side counts of every migrated business code, for reconciliation against the source. */
export async function reconcile(db: Executor, t: Transformed) {
  const q = async (table: string, col: string, codes: string[]) =>
    Number((await db.query(`select count(*)::int n from public.${table} where ${col} = any($1::text[])`, [codes])).rows[0].n);
  const expected = {
    customers: t.customers.length,
    enquiries: t.enquiries.length,
    pending_enquiries: t.pending.length,
    follow_ups: t.followUps.length,
    call_logs: t.calls.length,
  };
  const found = {
    customers: await q("customers", "cust_code", t.customers.map((c) => String(c.cust_code))),
    enquiries: await q("enquiries", "enq_code", t.enquiries.map((e) => String(e.enq_code))),
    pending_enquiries: await q("pending_enquiries", "pend_code", t.pending.map((p) => String(p.pend_code))),
    follow_ups: await q("follow_ups", "fu_code", t.followUps.map((f) => String(f.fu_code))),
    call_logs: await q("call_logs", "call_code", t.calls.map((c) => String(c.call_code))),
  };
  const differences = Object.fromEntries(
    Object.entries(expected).filter(([k, v]) => found[k as keyof typeof found] !== v).map(([k, v]) => [k, { expected: v, found: found[k as keyof typeof found] }]),
  );
  return { expected, found, differences, ok: Object.keys(differences).length === 0 };
}
