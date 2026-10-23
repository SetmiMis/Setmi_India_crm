// In-process Postgres (PGlite) that mimics the parts of Supabase the migrations rely on:
// roles anon/authenticated/service_role, auth.users, auth.uid() from the JWT claim, and
// Supabase's default privileges (which our security migration must actively revoke).
import fs from 'node:fs';
import path from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const SEED = path.join(ROOT, 'supabase', 'seed');

const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants these by default; the migrations must take them away again.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Db = PGlite;
export type Tx = Transaction;

export async function createDb(opts: { seedReference?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  if (opts.seedReference) {
    for (const f of fs.readdirSync(SEED).filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(SEED, f), 'utf8'));
    }
  }
  return db;
}

type Role = 'anon' | 'authenticated' | 'service_role';

/** Run fn inside a transaction as the given role/user (like a PostgREST request). Rolled back unless commit. */
export async function as<T>(db: PGlite, role: Role, userId: string | null, fn: (tx: Tx) => Promise<T>, commit = true): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.exec(`set local role ${role}`);
    const out = await fn(tx);
    if (!commit) await tx.rollback();
    return out;
  });
}

export async function rpc<T = unknown>(tx: Tx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const names = Object.keys(args);
  const params = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
  const values = names.map((n) => {
    const v = args[n];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const res = await tx.query<{ r: T }>(`select public.${fn}(${params}) as r`, values);
  return res.rows[0]?.r as T;
}

let seq = 0;
export async function createUser(db: PGlite, fullName: string, role: 'admin' | 'rep'): Promise<{ id: string; memberId: string }> {
  seq += 1;
  const id = crypto.randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `u${seq}@example.test`]);
  await as(db, 'service_role', null, (tx) =>
    rpc(tx, 'admin_create_profile', {
      p_user_id: id, p_username: `user${seq}`, p_full_name: fullName, p_role: role,
      p_email: `u${seq}@example.test`, p_actor: null,
    }),
  );
  const m = await db.query<{ id: string }>('select id from public.team_members where profile_id = $1', [id]);
  return { id, memberId: m.rows[0].id };
}

/** Assert a promise rejects with the given hint code (our RPC error contract). */
export async function rejectsWith(p: Promise<unknown>, hint: string, msg?: RegExp): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { hint?: string; message: string };
    if (err.hint !== hint) throw new Error(`expected hint "${hint}", got "${err.hint}" (${err.message})`);
    if (msg && !msg.test(err.message)) throw new Error(`message "${err.message}" does not match ${msg}`);
    return err.message;
  }
  throw new Error(`expected rejection with hint "${hint}"`);
}

export const sampleContact = (n: number) => ({
  customer_name: `Test Customer ${n}`,
  company: `Acme ${n}`,
  phone: `98${String(76500000 + n).padStart(8, '0')}`,
  email: `buyer${n}@example.test`,
  pincode: '110001',
  city: 'New Delhi',
  state: 'Delhi',
  requirement: 'Circular connector GX16 — Qty: 100',
});
