-- =============================================================================
-- SETMI INDIA CRM — foundation: schemas, extensions, reference data, identities
-- Target: Supabase Postgres 17. Idempotent where practical; never drops data.
-- Business rules referenced here come from the legacy Apps Script source
-- (src/Code.js CONFIG / STAGES / TIMELINES / ESCALATIONS) — see docs/DATABASE_SCHEMA.md.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Private schema: helper functions and internal state. NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Business identifier counters (replaces "max existing + 1" scans; fixes BUG-003
-- duplicate IDs and BUG-005 wrap-around after 9999).
-- -----------------------------------------------------------------------------
create table if not exists private.id_counters (
  prefix      text primary key,
  last_value  bigint not null default 0 check (last_value >= 0)
);

insert into private.id_counters (prefix) values
  ('SETMI-ENQ-'), ('CUST-'), ('PEND-'), ('FU-'), ('CALL-')
on conflict (prefix) do nothing;

-- Row-locking increment: concurrent callers serialize on the counter row, so two
-- transactions can never receive the same number. Pads to at least 4 digits and
-- grows beyond 9999 instead of wrapping (legacy padded with slice(-4)).
create or replace function private.next_code(p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  update private.id_counters
     set last_value = last_value + 1
   where prefix = p_prefix
  returning last_value into v;
  if v is null then
    raise exception 'Unknown id prefix %', p_prefix using errcode = 'P0001', hint = 'invalid';
  end if;
  return p_prefix || lpad(v::text, greatest(4, length(v::text)), '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Reference data
-- -----------------------------------------------------------------------------
create table if not exists public.lead_sources (
  name        text primary key,
  sort_order  int not null default 100,
  active      boolean not null default true
);
-- Verified values from CONFIG.SOURCES, plus 'Meta Ads' (new: Meta imports previously
-- landed as 'Other' with a MetaLeadID tag in Notes; see docs/ADR/0004).
insert into public.lead_sources (name, sort_order) values
  ('IndiaMART', 10), ('Phone', 20), ('TradeIndia', 30), ('Exhibition', 40), ('WhatsApp', 50),
  ('Referral', 60), ('Walk-in', 70), ('Website', 80), ('Meta Ads', 85), ('Other', 90)
on conflict (name) do nothing;

create table if not exists public.india_states (
  name  text primary key,
  iso   text not null unique,
  zone  text not null check (zone in ('North','South','East','West','Central','Northeast','Islands')),
  lat   numeric(8,4),
  lng   numeric(8,4)
);

-- Pincode centroids (seeded from the legacy PincodeGeo.js, GeoNames CC-BY 4.0).
create table if not exists public.pincode_geo (
  pincode  char(6) primary key check (pincode ~ '^[0-9]{6}$'),
  lat      numeric(8,4) not null,
  lng      numeric(8,4) not null
);

-- Company holidays skipped by the follow-up engine (legacy EXTRA_HOLIDAYS_, empty).
create table if not exists public.holidays (
  day    date primary key,
  label  text not null default ''
);

-- Small typed settings store (admin-only).
create table if not exists private.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
insert into private.app_settings (key, value) values
  ('meta_import_target', '"pending"'::jsonb),     -- 'pending' | 'enquiries' (legacy Apps Script = enquiries)
  ('calls_soft_limit',   '6'::jsonb),             -- MAX_CALLS_PER_ENQUIRY
  ('archive_after_months','6'::jsonb),            -- ARCHIVE_MONTHS_
  ('digest_recipients',  '[]'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Identities
--   profiles      = a login (1:1 with auth.users)
--   team_members  = the "Lead By" roster. Enquiry ownership points here, so legacy
--                   owners without a login are preserved and a renamed user no
--                   longer silently loses their leads (legacy matched on Name text).
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete restrict,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  full_name   text not null check (length(btrim(full_name)) between 1 and 80),
  role        text not null default 'rep' check (role in ('admin','rep')),
  active      boolean not null default true,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  active      boolean not null default true,
  profile_id  uuid unique references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists team_members_name_uq on public.team_members (lower(btrim(name)));
