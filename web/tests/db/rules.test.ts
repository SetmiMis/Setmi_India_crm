// Business-rule functions ported from src/Code.js — each case pins legacy behaviour.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, type Db } from './harness';

let db: Db;
before(async () => { db = await createDb(); });

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ v: T }>(sql, params)).rows[0].v;

test('gradeFor_ matrix (Qty × Timeline) matches legacy', async () => {
  const cases: Array<[number | null, string | null, string | null]> = [
    [600, 'Immediate', 'A'], [600, 'Fortnight', 'A'], [600, 'Just Exploring', 'B'],
    [100, 'Immediate', 'A'], [100, 'Fortnight', 'B'], [100, 'Just Exploring', 'C'],
    [20, 'Immediate', 'A'], [500, 'Fortnight', 'B'],
    [5, 'Immediate', 'B'], [5, 'Fortnight', 'C'], [5, 'Just Exploring', 'C'],
    [0, 'Immediate', null], [null, 'Immediate', null], [50, null, null], [50, 'Someday', null],
  ];
  for (const [q, t, want] of cases) {
    assert.equal(await one('select private.grade_for($1::numeric, $2) v', [q, t]), want, `grade(${q}, ${t})`);
  }
});

test('follow-up cadence: Hot 1 / Warm 2 / Cold 6 working days, Sundays skipped', async () => {
  // 2026-10-24 is a Saturday.
  assert.equal(await one(`select private.compute_next_follow_up('Hot', '2026-10-24')::text v`), '2026-10-26');
  assert.equal(await one(`select private.compute_next_follow_up('Warm', '2026-10-24')::text v`), '2026-10-27');
  assert.equal(await one(`select private.compute_next_follow_up('Cold', '2026-10-24')::text v`), '2026-10-31');
  assert.equal(await one(`select private.compute_next_follow_up(null, '2026-10-24')::text v`), '2026-10-27', 'unknown → Warm');
  assert.equal(await one(`select private.compute_next_follow_up('Hot', '2026-10-25')::text v`), '2026-10-26', 'from Sunday');
});

test('company holidays are skipped like Sundays', async () => {
  await db.exec(`insert into public.holidays (day, label) values ('2026-10-26', 'Test holiday')`);
  assert.equal(await one(`select private.compute_next_follow_up('Hot', '2026-10-24')::text v`), '2026-10-27');
  await db.exec(`delete from public.holidays where day = '2026-10-26'`);
});

test('follow-up status buckets', async () => {
  assert.equal(await one(`select private.follow_up_status(null) v`), 'No Follow-up');
  assert.equal(await one(`select private.follow_up_status(private.today() - 1) v`), 'Overdue');
  assert.equal(await one(`select private.follow_up_status(private.today()) v`), 'Today');
  assert.equal(await one(`select private.follow_up_status(private.today() + 1) v`), 'Tomorrow');
  assert.equal(await one(`select private.follow_up_status(private.today() + 5) v`), 'Upcoming');
});

test('stage transitions follow the documented pipeline', async () => {
  const allowed = async (from: string, to: string, admin = false) =>
    one<boolean>('select private.stage_transition_allowed($1, $2, $3) v', [from, to, admin]);
  assert.equal(await allowed('New', 'Quoted'), true);
  assert.equal(await allowed('Quoted', 'Follow-up'), true);
  assert.equal(await allowed('Follow-up', 'Won'), true);
  assert.equal(await allowed('Won', 'Dispatched'), true);
  assert.equal(await allowed('Dispatched', 'Closed'), true);
  assert.equal(await allowed('Won', 'Closed'), true);
  assert.equal(await allowed('Closed', 'New'), false);
  assert.equal(await allowed('Dispatched', 'Won'), false);
  assert.equal(await allowed('New', 'Dispatched'), false);
  assert.equal(await allowed('Lost', 'Follow-up'), false, 'reps cannot re-open');
  assert.equal(await allowed('Lost', 'Follow-up', true), true, 'admins can re-open');
});

test('phone key = last 10 digits', async () => {
  assert.equal(await one(`select public.phone_key('+91 98765-43210') v`), '9876543210');
  assert.equal(await one(`select public.phone_key('09876543210') v`), '9876543210');
  assert.equal(await one(`select public.phone_key('12345') v`), '12345');
  assert.equal(await one(`select public.phone_key(null) v`), '');
});

test('business codes are unique, padded to 4 and do not wrap after 9999 (BUG-005)', async () => {
  await db.exec(`update private.id_counters set last_value = 9998 where prefix = 'FU-'`);
  const a = await one<string>(`select private.next_code('FU-') v`);
  const b = await one<string>(`select private.next_code('FU-') v`);
  assert.equal(a, 'FU-9999');
  assert.equal(b, 'FU-10000');
  await db.exec(`update private.id_counters set last_value = 0 where prefix = 'FU-'`);
  assert.equal(await one<string>(`select private.next_code('FU-') v`), 'FU-0001');
});
