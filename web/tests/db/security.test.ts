// Authorization at the database layer: grants, RLS and in-function checks.
// Every test asserts both the allowed path and the denied path.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, as, rpc, createUser, rejectsWith, sampleContact, type Db } from './harness';

let db: Db;
let admin: { id: string; memberId: string };
let repA: { id: string; memberId: string };
let repB: { id: string; memberId: string };
let enqA: string; // owned by repA
let enqB: string; // owned by repB
let unclaimed: string;

async function approvedEnquiry(n: number, ownerMember: string | null): Promise<string> {
  const pend = await as(db, 'authenticated', admin.id, (tx) => rpc<{ id: string }>(tx, 'create_pending_enquiry', { p: sampleContact(n) }));
  const res = await as(db, 'authenticated', admin.id, (tx) =>
    rpc<{ enquiry_id: string }>(tx, 'approve_pending', { p_id: pend.id, p_owner: ownerMember }));
  return res.enquiry_id;
}

before(async () => {
  db = await createDb();
  admin = await createUser(db, 'Admin One', 'admin');
  repA = await createUser(db, 'Rep Alpha', 'rep');
  repB = await createUser(db, 'Rep Beta', 'rep');
  enqA = await approvedEnquiry(1, repA.memberId);
  enqB = await approvedEnquiry(2, repB.memberId);
  unclaimed = await approvedEnquiry(3, null);
});

test('anon cannot read any table', async () => {
  for (const t of ['enquiries', 'customers', 'profiles', 'pending_enquiries', 'call_logs', 'follow_ups', 'team_members']) {
    await assert.rejects(as(db, 'anon', null, (tx) => tx.query(`select * from public.${t} limit 1`)), /permission denied/, t);
  }
});

test('anon cannot execute any RPC, including public-looking ones', async () => {
  for (const fn of ['submit_public_enquiry', 'check_phone_duplicate', 'dashboard', 'public_metrics', 'approve_pending']) {
    await assert.rejects(
      as(db, 'anon', null, (tx) => tx.query(`select public.${fn}`.replace(/$/, '') + '()')),
      /permission denied|does not exist/,
      fn,
    );
  }
  await assert.rejects(as(db, 'anon', null, (tx) => rpc(tx, 'check_phone_duplicate', { p_phone: '9876500001' })), /permission denied/);
});

test('authenticated users have no direct write grants', async () => {
  await assert.rejects(
    as(db, 'authenticated', repA.id, (tx) => tx.query(`update public.enquiries set stage = 'Won' where id = $1`, [enqA])),
    /permission denied/,
  );
  await assert.rejects(
    as(db, 'authenticated', admin.id, (tx) => tx.query(`insert into public.team_members (name) values ('x')`)),
    /permission denied/,
  );
  await assert.rejects(
    as(db, 'authenticated', admin.id, (tx) => tx.query(`delete from public.customers`)),
    /permission denied/,
  );
});

test('service-only functions are denied to signed-in users (even admins)', async () => {
  for (const [fn, args] of [
    ['submit_public_enquiry', { p: sampleContact(9), p_idempotency_key: 'x'.repeat(20) }],
    ['public_metrics', {}],
    ['oms_complete_order', { p_request_key: crypto.randomUUID(), p_ok: true, p_oms_order_id: 'ORD-1', p_error: '', p_payload: {} }],
    ['admin_create_profile', { p_user_id: crypto.randomUUID(), p_username: 'evil', p_full_name: 'Evil', p_role: 'admin', p_email: '', p_actor: null }],
    ['resolve_share_link', { p_token_hash: 'a'.repeat(64) }],
    ['analysis_rows_shared', {}],
    ['digest_data', {}],
  ] as const) {
    await assert.rejects(as(db, 'authenticated', admin.id, (tx) => rpc(tx, fn, args)), /permission denied/, fn);
  }
});

test('RLS: rep sees only own enquiries; admin sees all', async () => {
  const seen = async (uid: string) =>
    (await as(db, 'authenticated', uid, (tx) => tx.query<{ id: string }>('select id from public.enquiries'))).rows.map((r) => r.id);
  const a = await seen(repA.id);
  assert.deepEqual(a, [enqA]);
  const b = await seen(repB.id);
  assert.deepEqual(b, [enqB]);
  const all = await seen(admin.id);
  assert.equal(all.length, 3);
});

test('RLS: changing a filter/ID cannot read another rep’s enquiry or its activity', async () => {
  const r = await as(db, 'authenticated', repA.id, (tx) => tx.query('select * from public.enquiries where id = $1', [enqB]));
  assert.equal(r.rows.length, 0);
  const f = await as(db, 'authenticated', repA.id, (tx) => tx.query('select * from public.follow_ups where enquiry_id = $1', [enqB]));
  assert.equal(f.rows.length, 0);
  const c = await as(db, 'authenticated', repA.id, (tx) => tx.query('select * from public.customers'));
  assert.equal(c.rows.length, 1, 'rep sees only customers of own leads');
});

test('reps cannot mutate another rep’s lead through RPCs', async () => {
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'move_stage', { p_id: enqB, p_stage: 'Lost', p: { lost_reason: 'x' }, p_expected_version: null })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'log_call', { p_enquiry_id: enqB, p: { call_status: 'Connected' } })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'update_enquiry', { p_id: enqB, p: { requirement: 'x' }, p_expected_version: null })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'soft_delete_enquiry', { p_id: enqB, p_reason: '' })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'propose_transfer', { p_id: enqB, p_to_member: repA.memberId })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'oms_begin_order', { p_enquiry_id: enqB, p_request_key: crypto.randomUUID() })), 'forbidden');
});

test('reps cannot reassign a lead by editing owner_id (BUG-010)', async () => {
  await rejectsWith(
    as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'update_enquiry', { p_id: enqA, p: { owner_id: repB.memberId }, p_expected_version: null })),
    'forbidden', /Transfer/,
  );
});

test('only admins approve/reject pending enquiries (BUG-011)', async () => {
  const pend = await as(db, 'authenticated', repA.id, (tx) => rpc<{ id: string }>(tx, 'create_pending_enquiry', { p: sampleContact(10) }));
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'approve_pending', { p_id: pend.id, p_owner: null })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'reject_pending', { p_id: pend.id, p_reason: 'spam' })), 'forbidden');
  // rep sees own submission but not someone else's
  const mine = await as(db, 'authenticated', repA.id, (tx) => tx.query('select id from public.pending_enquiries'));
  assert.deepEqual(mine.rows.map((r) => (r as { id: string }).id), [pend.id]);
  const other = await as(db, 'authenticated', repB.id, (tx) => tx.query('select id from public.pending_enquiries'));
  assert.equal(other.rows.length, 0);
});

test('admin-only reads and actions are rejected for reps', async () => {
  for (const fn of ['reports_summary', 'team_performance', 'admin_get_settings', 'admin_list_share_links', 'admin_audit_log']) {
    const p = as(db, 'authenticated', repA.id, (tx) => rpc(tx, fn, {}));
    if (fn === 'admin_get_settings') assert.equal(await p, null);
    else await rejectsWith(p, 'forbidden');
  }
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'admin_add_team_member', { p_name: 'Sneaky' })), 'forbidden');
  await rejectsWith(as(db, 'authenticated', repA.id, (tx) => rpc(tx, 'archive_closed_enquiries', { p_months: 1 })), 'forbidden');
});

test('dashboard: a rep asking for another owner still gets only their own numbers', async () => {
  const d = await as(db, 'authenticated', repA.id, (tx) =>
    rpc<{ kpis: { total_enquiries: number } }>(tx, 'dashboard', { p_filters: { owner_id: repB.memberId } }));
  assert.equal(d.kpis.total_enquiries, 1);
  const all = await as(db, 'authenticated', admin.id, (tx) => rpc<{ kpis: { total_enquiries: number } }>(tx, 'dashboard', { p_filters: {} }));
  assert.equal(all.kpis.total_enquiries, 3);
  const un = await as(db, 'authenticated', admin.id, (tx) =>
    rpc<{ kpis: { total_enquiries: number } }>(tx, 'dashboard', { p_filters: { owner_id: 'unassigned' } }));
  assert.equal(un.kpis.total_enquiries, 1);
});

test('deactivated users lose access immediately', async () => {
  const tmp = await createUser(db, 'Temp Rep', 'rep');
  await as(db, 'authenticated', tmp.id, (tx) => rpc(tx, 'claim_enquiry', { p_id: unclaimed, p_priority: 'Hot' }));
  const before_ = await as(db, 'authenticated', tmp.id, (tx) => tx.query('select id from public.enquiries'));
  assert.equal(before_.rows.length, 1);
  await as(db, 'service_role', null, (tx) =>
    rpc(tx, 'admin_update_profile', { p_user_id: tmp.id, p_role: null, p_active: false, p_actor: admin.id }));
  const after = await as(db, 'authenticated', tmp.id, (tx) => tx.query('select id from public.enquiries'));
  assert.equal(after.rows.length, 0);
  await rejectsWith(as(db, 'authenticated', tmp.id, (tx) => rpc(tx, 'dashboard', { p_filters: {} })), 'unauthenticated');
});

test('admins cannot demote themselves or remove the last admin', async () => {
  await rejectsWith(as(db, 'service_role', null, (tx) =>
    rpc(tx, 'admin_update_profile', { p_user_id: admin.id, p_role: 'rep', p_active: null, p_actor: admin.id })), 'invalid');
  await rejectsWith(as(db, 'service_role', null, (tx) =>
    rpc(tx, 'admin_update_profile', { p_user_id: admin.id, p_role: null, p_active: true, p_actor: repA.id })), 'forbidden');
});

test('no SECURITY DEFINER function in exposed schema lacks a fixed search_path', async () => {
  const r = await db.query<{ proname: string }>(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(r.rows, []);
});

test('every table in public has RLS enabled', async () => {
  const r = await db.query<{ relname: string }>(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(r.rows, []);
});

test('authenticated EXECUTE grants are an explicit allow-list', async () => {
  const r = await db.query<{ proname: string }>(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
  const granted = new Set(r.rows.map((x) => x.proname));
  for (const serverOnly of ['submit_public_enquiry', 'public_metrics', 'oms_complete_order', 'admin_create_profile',
    'admin_update_profile', 'resolve_share_link', 'verify_metrics_key', 'rate_limit_hit', 'analysis_rows_shared',
    'digest_data', 'job_try_start', 'job_finish']) {
    assert.equal(granted.has(serverOnly), false, `${serverOnly} must be service_role only`);
  }
  const anon = await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute')`);
  assert.deepEqual(anon.rows, [], 'anon must not execute anything');
});
