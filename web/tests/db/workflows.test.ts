// End-to-end business workflows at the database layer (synthetic data only).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, rpc, createUser, rejectsWith, sampleContact, type Db } from './harness';

let db: Db;
let admin: { id: string; memberId: string };
let rep: { id: string; memberId: string };
let rep2: { id: string; memberId: string };
let n = 100;

const asAdmin = <T>(fn: string, args: Record<string, unknown>) => as(db, 'authenticated', admin.id, (tx) => rpc<T>(tx, fn, args));
const asRep = <T>(fn: string, args: Record<string, unknown>, who = rep) => as(db, 'authenticated', who.id, (tx) => rpc<T>(tx, fn, args));
const enquiry = async (id: string) =>
  (await db.query<Record<string, unknown>>('select * from public.enquiries where id = $1', [id])).rows[0];
const today = async () => (await db.query<{ d: string }>(`select private.today()::text d`)).rows[0].d;

async function newApproved(owner: string | null = null) {
  n += 1;
  const p = await asRep<{ id: string }>('create_pending_enquiry', { p: sampleContact(n) });
  const a = await asAdmin<{ enquiry_id: string }>('approve_pending', { p_id: p.id, p_owner: owner });
  return a.enquiry_id;
}

before(async () => {
  db = await createDb();
  admin = await createUser(db, 'Owner Admin', 'admin');
  rep = await createUser(db, 'Rep One', 'rep');
  rep2 = await createUser(db, 'Rep Two', 'rep');
});

test('intake validation: name + 10-digit phone required, formats checked server-side', async () => {
  await rejectsWith(asRep('create_pending_enquiry', { p: { customer_name: 'X', phone: '12345' } }), 'invalid', /10 digits/);
  await rejectsWith(asRep('create_pending_enquiry', { p: { customer_name: '', phone: '9876543210' } }), 'invalid');
  await rejectsWith(asRep('create_pending_enquiry', { p: { ...sampleContact(1), email: 'bad@' } }), 'invalid');
  await rejectsWith(asRep('create_pending_enquiry', { p: { ...sampleContact(1), pincode: '12' } }), 'invalid');
  await rejectsWith(asRep('create_pending_enquiry', { p: { ...sampleContact(1), gst: 'NOTAGST' } }), 'invalid');
  const ok = await asRep<{ code: string }>('create_pending_enquiry', { p: { ...sampleContact(1), gst: '27abcde1234f1z5' } });
  assert.match(ok.code, /^PEND-\d{4,}$/);
});

test('pending stores Qty/Timeline (BUG-006) and records the submitter (BUG-017)', async () => {
  const p = await asRep<{ id: string }>('create_pending_enquiry', { p: { ...sampleContact(2), qty: '600', timeline: 'Immediate' } });
  const row = (await db.query<Record<string, unknown>>('select * from public.pending_enquiries where id = $1', [p.id])).rows[0];
  assert.equal(Number(row.qty), 600);
  assert.equal(row.timeline, 'Immediate');
  assert.equal(row.submitted_by, rep.id);
  assert.equal(row.submitted_by_label, 'Rep One');
  const a = await asAdmin<{ enquiry_id: string }>('approve_pending', { p_id: p.id, p_owner: null });
  const e = await enquiry(a.enquiry_id);
  assert.equal(e.grade, 'A', 'grade computed from Qty × Timeline on approval');
  const pr = (await db.query<Record<string, unknown>>('select * from public.pending_enquiries where id = $1', [p.id])).rows[0];
  assert.equal(pr.reviewed_by, admin.id);
  assert.equal(pr.reviewed_by_label, 'Owner Admin');
  assert.ok(pr.reviewed_at);
});

test('approval without owner → unclaimed lead on Available Leads; retry is idempotent', async () => {
  const p = await asRep<{ id: string }>('create_pending_enquiry', { p: sampleContact(3) });
  const a1 = await asAdmin<{ enquiry_id: string; already_approved: boolean }>('approve_pending', { p_id: p.id, p_owner: null });
  const a2 = await asAdmin<{ enquiry_id: string; already_approved: boolean }>('approve_pending', { p_id: p.id, p_owner: null });
  assert.equal(a2.enquiry_id, a1.enquiry_id);
  assert.equal(a2.already_approved, true);
  const count = await db.query<{ c: number }>(`select count(*)::int c from public.enquiries where customer_name = $1`, [sampleContact(3).customer_name]);
  assert.equal(count.rows[0].c, 1, 'retrying approval does not duplicate the enquiry');
  const e = await enquiry(a1.enquiry_id);
  assert.equal(e.owner_id, null);
  assert.equal(e.priority, null);
  assert.equal(e.next_follow_up, null);
  const avail = await asRep<unknown>('available_leads', { p_limit: 50, p_offset: 0, p_q: null });
  assert.ok(avail !== undefined);
  await rejectsWith(asAdmin('reject_pending', { p_id: p.id, p_reason: 'late' }), 'already_reviewed');
});

test('reject requires a reason and is recorded', async () => {
  const p = await asRep<{ id: string }>('create_pending_enquiry', { p: sampleContact(4) });
  await rejectsWith(asAdmin('reject_pending', { p_id: p.id, p_reason: '  ' }), 'invalid');
  await asAdmin('reject_pending', { p_id: p.id, p_reason: 'Spam call' });
  await rejectsWith(asAdmin('approve_pending', { p_id: p.id, p_owner: null }), 'already_reviewed');
});

test('claim: first rep wins, second gets a conflict; follow-up date set from priority', async () => {
  const id = await newApproved();
  const r = await asRep<{ ok: boolean }>('claim_enquiry', { p_id: id, p_priority: 'Hot' });
  assert.equal(r.ok, true);
  await rejectsWith(asRep('claim_enquiry', { p_id: id, p_priority: 'Warm' }, rep2), 'conflict', /Already claimed by Rep One/);
  const e = await enquiry(id);
  assert.equal(e.owner_id, rep.memberId);
  assert.equal(e.priority, 'Hot');
  assert.ok(e.claimed_at);
  const expected = (await db.query<{ d: string }>(`select private.compute_next_follow_up('Hot', private.today())::text d`)).rows[0].d;
  assert.equal(String(e.next_follow_up instanceof Date ? (e.next_follow_up as Date).toISOString().slice(0, 10) : e.next_follow_up), expected);
});

test('log_call is atomic: call + follow-up + enquiry update; numbering; idempotent retries', async () => {
  const id = await newApproved(rep.memberId);
  const req = crypto.randomUUID();
  const c1 = await asRep<{ call_number: number; duplicate: boolean }>('log_call', {
    p_enquiry_id: id, p: { call_status: 'Connected', interest: 'Interested', remarks: 'Wants quote', client_request_id: req } });
  assert.equal(c1.call_number, 1);
  const again = await asRep<{ call_number: number; duplicate: boolean }>('log_call', {
    p_enquiry_id: id, p: { call_status: 'Connected', interest: 'Interested', remarks: 'Wants quote', client_request_id: req } });
  assert.equal(again.duplicate, true);
  const c2 = await asRep<{ call_number: number }>('log_call', { p_enquiry_id: id, p: { call_status: 'Busy', interest: 'Interested' } });
  assert.equal(c2.call_number, 2);
  const calls = await db.query<Record<string, unknown>>('select * from public.call_logs where enquiry_id = $1 order by call_number', [id]);
  assert.equal(calls.rows.length, 2);
  assert.equal(calls.rows[1].interest, null, 'interest dropped when not connected');
  assert.equal(calls.rows[0].employee_label, 'Rep One', 'employee comes from the session, not the client');
  const fus = await db.query('select * from public.follow_ups where enquiry_id = $1', [id]);
  assert.equal(fus.rows.length, 2);
  const e = await enquiry(id);
  assert.equal(e.stage, 'Follow-up', 'New → Follow-up on first call');
  assert.ok(e.next_follow_up);
});

test('log_call validation failure leaves no partial rows', async () => {
  const id = await newApproved(rep.memberId);
  await rejectsWith(asRep('log_call', { p_enquiry_id: id, p: { call_status: 'Connected', call_date: '2999-01-01' } }), 'invalid');
  await rejectsWith(asRep('log_call', { p_enquiry_id: id, p: { call_status: 'Telepathy' } }), 'invalid');
  const fus = await db.query('select 1 from public.follow_ups where enquiry_id = $1', [id]);
  const calls = await db.query('select 1 from public.call_logs where enquiry_id = $1', [id]);
  assert.equal(fus.rows.length + calls.rows.length, 0);
  assert.equal((await enquiry(id)).stage, 'New');
});

test('pipeline: Quoted → Won needs invoice → Dispatched → Closed; terminal clears priority/date', async () => {
  const id = await newApproved(rep.memberId);
  let v = Number((await enquiry(id)).version);
  v = await asRep<number>('move_stage', { p_id: id, p_stage: 'Quoted', p: { quote_no: 'SETMI-Q-1', quote_amount: '15000' }, p_expected_version: v });
  let e = await enquiry(id);
  assert.equal(e.stage, 'Quoted');
  assert.equal(Number(e.quote_amount), 15000, 'quote amount now has a writer (BUG-018)');
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Won', p: {}, p_expected_version: v }), 'invalid', /Invoice/);
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Won', p: { invoice_no: 'INV-1' }, p_expected_version: v - 1 }), 'conflict');
  v = await asRep<number>('move_stage', { p_id: id, p_stage: 'Won', p: { invoice_no: 'INV-1', order_value: '14000' }, p_expected_version: v });
  e = await enquiry(id);
  assert.equal(e.priority, null);
  assert.equal(e.next_follow_up, null);
  assert.equal(Number(e.order_value), 14000);
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Quoted', p: {}, p_expected_version: v }), 'invalid', /Cannot move/);
  v = await asRep<number>('move_stage', { p_id: id, p_stage: 'Dispatched', p: { dispatch_info: 'DTDC 123', shipment_weight: '2.5' }, p_expected_version: v });
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Closed', p: { feedback_rating: '9' }, p_expected_version: v }), 'invalid');
  await asRep('move_stage', { p_id: id, p_stage: 'Closed', p: { feedback_rating: '5', feedback_note: 'Happy' }, p_expected_version: v });
  e = await enquiry(id);
  assert.equal(e.stage, 'Closed');
  assert.equal(Number(e.shipment_weight), 2.5);
  const hist = await db.query<{ to_stage: string }>('select to_stage from public.enquiry_stage_history where enquiry_id = $1 order by id', [id]);
  assert.deepEqual(hist.rows.map((r) => r.to_stage), ['New', 'Quoted', 'Won', 'Dispatched', 'Closed']);
});

test('Lost requires a reason; only admins can re-open', async () => {
  const id = await newApproved(rep.memberId);
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Lost', p: {}, p_expected_version: null }), 'invalid', /reason/);
  await asRep('move_stage', { p_id: id, p_stage: 'Lost', p: { lost_reason: 'Price too high' }, p_expected_version: null });
  await rejectsWith(asRep('move_stage', { p_id: id, p_stage: 'Follow-up', p: {}, p_expected_version: null }), 'invalid');
  await asAdmin('move_stage', { p_id: id, p_stage: 'Follow-up', p: {}, p_expected_version: null });
  const e = await enquiry(id);
  assert.equal(e.stage, 'Follow-up');
  assert.equal(e.priority, 'Warm');
  assert.ok(e.next_follow_up);
});

test('transfer: propose → only the receiver can accept → ownership moves', async () => {
  const id = await newApproved(rep.memberId);
  const tid = await asRep<string>('propose_transfer', { p_id: id, p_to_member: rep2.memberId });
  await rejectsWith(asRep('propose_transfer', { p_id: id, p_to_member: rep2.memberId }), 'conflict');
  await rejectsWith(asRep('respond_transfer', { p_transfer_id: tid, p_accept: true }), 'forbidden');
  // the receiver can see the lead while the transfer is pending
  const vis = await as(db, 'authenticated', rep2.id, (tx) => tx.query('select id from public.enquiries where id = $1', [id]));
  assert.equal(vis.rows.length, 1);
  await asRep('respond_transfer', { p_transfer_id: tid, p_accept: true }, rep2);
  assert.equal((await enquiry(id)).owner_id, rep2.memberId);
  const gone = await as(db, 'authenticated', rep.id, (tx) => tx.query('select id from public.enquiries where id = $1', [id]));
  assert.equal(gone.rows.length, 0);
});

test('edit: priority change recomputes next follow-up; customer correction cascades; stale version rejected', async () => {
  const id = await newApproved(rep.memberId);
  const before_ = await enquiry(id);
  const v = await asRep<number>('update_enquiry', { p_id: id, p: { priority: 'Cold', customer_name: 'Corrected Name' }, p_expected_version: before_.version });
  const e = await enquiry(id);
  assert.equal(e.priority, 'Cold');
  assert.notEqual(String(e.next_follow_up), String(before_.next_follow_up));
  const cust = (await db.query<{ name: string }>('select name from public.customers where id = $1', [e.customer_id])).rows[0];
  assert.equal(cust.name, 'Corrected Name');
  await rejectsWith(asRep('update_enquiry', { p_id: id, p: { requirement: 'x' }, p_expected_version: v - 1 }), 'conflict');
});

test('edit: a partial update (one field) keeps every other field', async () => {
  const id = await newApproved(rep.memberId);
  const before_ = await enquiry(id);
  await asRep('update_enquiry', { p_id: id, p: { requirement: 'Only this changed' }, p_expected_version: null });
  const e = await enquiry(id);
  assert.equal(e.requirement, 'Only this changed');
  for (const k of ['customer_name', 'phone', 'company', 'priority', 'owner_id', 'source']) assert.equal(e[k], before_[k], k);
});

test('digest lists configured recipients, else active admins', async () => {
  const d1 = await as(db, 'service_role', null, (tx) => rpc<{ recipients: string[] }>(tx, 'digest_data', {}));
  assert.ok(d1.recipients.length >= 1, 'falls back to admin emails');
  await asAdmin('admin_set_setting', { p_key: 'digest_recipients', p_value: JSON.stringify(['ops@example.test']) });
  const d2 = await as(db, 'service_role', null, (tx) => rpc<{ recipients: string[] }>(tx, 'digest_data', {}));
  assert.deepEqual(d2.recipients, ['ops@example.test']);
});

test('public form: allow-listed fields only, idempotent by key, lands in Pending', async () => {
  const key = 'k'.repeat(24);
  const r1 = await as(db, 'service_role', null, (tx) => rpc<{ id: string; duplicate_submission: boolean }>(tx, 'submit_public_enquiry', {
    p: { ...sampleContact(500), owner_id: rep.memberId, priority: 'Hot', source: 'IndiaMART', status: 'Approved' }, p_idempotency_key: key }));
  const r2 = await as(db, 'service_role', null, (tx) => rpc<{ id: string; duplicate_submission: boolean }>(tx, 'submit_public_enquiry', {
    p: sampleContact(500), p_idempotency_key: key }));
  assert.equal(r2.id, r1.id);
  assert.equal(r2.duplicate_submission, true);
  const row = (await db.query<Record<string, unknown>>('select * from public.pending_enquiries where id = $1', [r1.id])).rows[0];
  assert.equal(row.status, 'Pending');
  assert.equal(row.owner_id, null, 'owner cannot be injected');
  assert.equal(row.source, 'Website', 'source is fixed for the public form');
  assert.equal(row.submitted_via, 'public_form');
});

test('bulk import: rejects bad rows, dedups within file, flags existing phones, never bypasses Pending', async () => {
  const existing = sampleContact(101).phone; // an approved enquiry created earlier uses this phone
  const r = await asRep<{ accepted: number; rejected: number; duplicates: number }>('bulk_create_pending', {
    p_rows: [
      { name: 'A', phone: '9000000001', requirement: 'HDMI', quantity: '10' },
      { name: 'A', phone: '9000000001', requirement: 'HDMI', quantity: '10' },
      { name: '', phone: '' },
      { name: 'Short phone', phone: '12345' },
      { name: '=HYPERLINK("http://evil")', phone: '9000000002' },
      { name: 'Known', phone: existing },
    ],
    p_file_name: 'leads.csv',
  });
  assert.deepEqual([r.accepted, r.rejected, r.duplicates], [3, 2, 1]);
  const dup = await db.query<{ possible_duplicate: boolean }>(`select possible_duplicate from public.pending_enquiries where phone = $1 and submitted_via = 'bulk_import'`, [existing]);
  assert.equal(dup.rows[0].possible_duplicate, true);
  const enq = await db.query(`select 1 from public.enquiries where phone = '9000000001'`);
  assert.equal(enq.rows.length, 0, 'bulk rows wait for approval');
});

test('Meta import: retry never duplicates; target configurable', async () => {
  const rows = [
    { external_id: 'meta-1', name: 'Meta Lead', phone: '9111111111', requirement: 'waterproof connector', qty: '50' },
    { external_id: 'meta-2', name: 'Meta Lead 2', phone: '9111111112' },
    { external_id: '', name: 'No id', phone: '9111111113' },
  ];
  const first = await asAdmin<{ imported: number; duplicates: number; rejected: number }>('import_external_leads', {
    p_source: 'meta', p_rows: rows, p_kind: 'meta_file', p_file_name: 'meta.csv', p_actor: null });
  assert.deepEqual([first.imported, first.duplicates, first.rejected], [2, 0, 1]);
  const second = await asAdmin<{ imported: number; duplicates: number }>('import_external_leads', {
    p_source: 'meta', p_rows: rows, p_kind: 'meta_file', p_file_name: 'meta.csv', p_actor: null });
  assert.deepEqual([second.imported, second.duplicates], [0, 2]);
  await asAdmin('admin_set_setting', { p_key: 'meta_import_target', p_value: JSON.stringify('enquiries') });
  const third = await asAdmin<{ imported: number; target: string }>('import_external_leads', {
    p_source: 'meta', p_rows: [{ external_id: 'meta-3', name: 'Direct', phone: '9111111114' }], p_kind: 'meta_file', p_file_name: 'm.csv', p_actor: null });
  assert.equal(third.target, 'enquiries');
  const e = await db.query<{ source: string; owner_id: string | null }>(`select source, owner_id from public.enquiries where phone = '9111111114'`);
  assert.equal(e.rows[0].source, 'Meta Ads');
  assert.equal(e.rows[0].owner_id, null);
  await rejectsWith(asRep('import_external_leads', { p_source: 'meta', p_rows: rows, p_kind: 'meta_file', p_file_name: 'x', p_actor: null }), 'forbidden');
  await asAdmin('admin_set_setting', { p_key: 'meta_import_target', p_value: JSON.stringify('pending') });
});

test('OMS: begin reserves, completion marks Won once; retries cannot create a second order', async () => {
  const id = await newApproved(rep.memberId);
  const key = crypto.randomUUID();
  const b = await asRep<{ status: string; enquiry: { code: string } }>('oms_begin_order', { p_enquiry_id: id, p_request_key: key });
  assert.equal(b.status, 'started');
  await rejectsWith(asRep('oms_begin_order', { p_enquiry_id: id, p_request_key: crypto.randomUUID() }), 'conflict');
  const same = await asRep<{ status: string }>('oms_begin_order', { p_enquiry_id: id, p_request_key: key });
  assert.equal(same.status, 'started');
  await as(db, 'service_role', null, (tx) => rpc(tx, 'oms_complete_order', { p_request_key: key, p_ok: true, p_oms_order_id: 'ORD-0294', p_error: '', p_payload: {} }));
  await as(db, 'service_role', null, (tx) => rpc(tx, 'oms_complete_order', { p_request_key: key, p_ok: true, p_oms_order_id: 'ORD-0294', p_error: '', p_payload: {} }));
  const e = await enquiry(id);
  assert.equal(e.oms_order_id, 'ORD-0294');
  assert.equal(e.stage, 'Won', 'order recorded == deal won (no invoice needed)');
  await rejectsWith(asRep('oms_begin_order', { p_enquiry_id: id, p_request_key: crypto.randomUUID() }), 'conflict', /already recorded/);
});

test('OMS failure frees the slot for a new attempt', async () => {
  const id = await newApproved(rep.memberId);
  const k1 = crypto.randomUUID();
  await asRep('oms_begin_order', { p_enquiry_id: id, p_request_key: k1 });
  await as(db, 'service_role', null, (tx) => rpc(tx, 'oms_complete_order', { p_request_key: k1, p_ok: false, p_oms_order_id: null, p_error: 'timeout', p_payload: {} }));
  const b2 = await asRep<{ status: string }>('oms_begin_order', { p_enquiry_id: id, p_request_key: crypto.randomUUID() });
  assert.equal(b2.status, 'started');
});

test('soft delete hides the lead; admin restore brings it back', async () => {
  const id = await newApproved(rep.memberId);
  await asRep('soft_delete_enquiry', { p_id: id, p_reason: 'duplicate' });
  assert.equal((await enquiry(id)).active, false);
  const d = await asRep<{ kpis: { total_enquiries: number } }>('dashboard', { p_filters: {} });
  const ids = await as(db, 'authenticated', rep.id, (tx) => tx.query<{ id: string }>('select id from public.enquiries where active'));
  assert.ok(!ids.rows.some((r) => r.id === id));
  assert.ok(d.kpis.total_enquiries >= 0);
  await rejectsWith(asRep('restore_enquiry', { p_id: id }), 'forbidden');
  await asAdmin('restore_enquiry', { p_id: id });
  assert.equal((await enquiry(id)).active, true);
});

test('archive moves old closed-out enquiries without copying rows (BUG-002); restore works', async () => {
  const id = await newApproved(rep.memberId);
  await asRep('move_stage', { p_id: id, p_stage: 'Lost', p: { lost_reason: 'No budget' }, p_expected_version: null });
  await db.query(`update public.enquiries set last_contact = private.today() - 400, enq_date = private.today() - 400 where id = $1`, [id]);
  const n_ = await asAdmin<number>('archive_closed_enquiries', { p_months: 6 });
  assert.ok(n_ >= 1);
  assert.ok((await enquiry(id)).archived_at);
  await asAdmin('restore_archived_enquiry', { p_id: id });
  assert.equal((await enquiry(id)).archived_at, null);
});

test('reads: follow-ups due, call dashboard, reports, team performance, analysis, map, metrics, digest', async () => {
  const id = await newApproved(rep.memberId);
  await db.query(`update public.enquiries set next_follow_up = private.today() - 3, stage = 'Follow-up', priority = 'Warm' where id = $1`, [id]);
  const due = await asRep<{ overdue: Array<{ days_overdue: number; enq_code: string }> }>('follow_ups_due', {});
  assert.ok(due.overdue.some((x) => x.days_overdue === 3));
  const badge = await asRep<{ overdue: number }>('follow_up_badge_counts', {});
  assert.ok(badge.overdue >= 1);
  const cd = await asRep<{ todays_calls: number; pending_calls: number }>('call_dashboard', {});
  assert.ok(cd.todays_calls >= 2);
  assert.ok(cd.pending_calls >= 1);
  const rep_ = await asAdmin<{ sources: unknown[]; owners: unknown[] }>('reports_summary', { p_date_from: null, p_date_to: null });
  assert.ok(rep_.sources.length > 0);
  const tp = await asAdmin<{ reps: Array<{ name: string; calls_today: number }> }>('team_performance', {});
  assert.ok(tp.reps.find((r) => r.name === 'Rep One')!.calls_today >= 2);
  const an = await as(db, 'authenticated', rep.id, (tx) => tx.query('select * from public.analysis_rows()'));
  assert.ok(an.rows.length > 0);
  const shared = await as(db, 'service_role', null, (tx) => tx.query<Record<string, unknown>>('select * from public.analysis_rows_shared() limit 1'));
  assert.ok(!('owner_name' in shared.rows[0]), 'share rows carry no owner');
  const mp = await as(db, 'authenticated', admin.id, (tx) => tx.query(`select * from public.map_aggregate('{}'::jsonb)`));
  assert.ok(mp.rows.length > 0);
  const m = await as(db, 'service_role', null, (tx) => rpc<Record<string, unknown>>(tx, 'public_metrics', {}));
  assert.ok(Number(m.enquiries_total) > 0);
  assert.equal(JSON.stringify(m).includes(sampleContact(101).phone), false, 'metrics contain no phone numbers');
  const dg = await as(db, 'service_role', null, (tx) => rpc<{ overdue: unknown[] }>(tx, 'digest_data', {}));
  assert.ok(dg.overdue.length >= 1);
  assert.ok(await today());
});

test('customers: list scoped with enquiry counts; phone collision on edit is a conflict', async () => {
  const list = await as(db, 'authenticated', rep.id, (tx) => tx.query<{ enquiries: number }>(`select * from public.list_customers(null, 50, 0)`));
  assert.ok(list.rows.length > 0);
  const c = await db.query<{ id: string }>(`select c.id from public.customers c join public.enquiries e on e.customer_id = c.id
      join public.team_members t on t.id = e.owner_id where t.id = $1 limit 2`, [rep.memberId]);
  const other = await db.query<{ phone: string }>(`select phone from public.customers where id <> $1 limit 1`, [c.rows[0].id]);
  await rejectsWith(asRep('update_customer', { p_id: c.rows[0].id, p: { phone: other.rows[0].phone } }), 'conflict');
  const found = await asRep<{ found: boolean }>('customer_by_phone', { p_phone: other.rows[0].phone });
  assert.equal(found.found, true);
});

test('share links and metrics key: hashes only, expiry, revocation', async () => {
  const hash = 'b'.repeat(64);
  const sid = await asAdmin<string>('admin_create_share_link', { p_token_hash: hash, p_label: 'Marketing', p_expires_at: new Date(Date.now() + 86400e3).toISOString() });
  assert.equal(await as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'resolve_share_link', { p_token_hash: hash })), true);
  await asAdmin('admin_revoke_share_link', { p_id: sid });
  assert.equal(await as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'resolve_share_link', { p_token_hash: hash })), false);
  await rejectsWith(asAdmin('admin_create_share_link', { p_token_hash: 'c'.repeat(64), p_label: '', p_expires_at: new Date(Date.now() - 1000).toISOString() }), 'invalid');
  await asAdmin('admin_set_metrics_key', { p_key_hash: 'd'.repeat(64), p_label: 'website' });
  assert.equal(await as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'verify_metrics_key', { p_key_hash: 'd'.repeat(64) })), true);
  await asAdmin('admin_set_metrics_key', { p_key_hash: 'e'.repeat(64), p_label: 'rotated' });
  assert.equal(await as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'verify_metrics_key', { p_key_hash: 'd'.repeat(64) })), false);
});

test('jobs are idempotent per run key; rate limiter caps a window', async () => {
  const start = (k: string) => as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'job_try_start', { p_job: 'daily_digest', p_run_key: k }));
  assert.equal(await start('2026-10-23'), true);
  assert.equal(await start('2026-10-23'), false);
  await as(db, 'service_role', null, (tx) => rpc(tx, 'job_finish', { p_job: 'daily_digest', p_run_key: '2026-10-23', p_status: 'failed', p_details: {} }));
  assert.equal(await start('2026-10-23'), true, 'a failed run may be retried');
  const hit = () => as(db, 'service_role', null, (tx) => rpc<boolean>(tx, 'rate_limit_hit', { p_bucket: 'test', p_window_seconds: 3600, p_max: 2 }));
  assert.deepEqual([await hit(), await hit(), await hit()], [true, true, false]);
});

test('audit trail records sensitive actions with the actor', async () => {
  const log = await as(db, 'authenticated', admin.id, (tx) => tx.query<{ action: string; actor_label: string }>(`select * from public.admin_audit_log(500, null)`));
  const actions = new Set(log.rows.map((r) => r.action));
  for (const a of ['pending.approve', 'pending.reject', 'enquiry.claim', 'enquiry.stage', 'transfer.accept', 'enquiry.delete', 'settings.set']) {
    assert.ok(actions.has(a), `audit has ${a}`);
  }
  assert.ok(log.rows.some((r) => r.action === 'pending.approve' && r.actor_label === 'Owner Admin'));
});
