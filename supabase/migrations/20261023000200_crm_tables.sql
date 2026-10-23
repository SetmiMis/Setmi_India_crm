-- =============================================================================
-- SETMI INDIA CRM — core business tables
-- Column semantics: *_date = business date (Asia/Kolkata calendar day, type date);
--                   *_at   = instant (timestamptz, server clock).
-- Legacy sheet → table mapping: docs/DATA_MIGRATION.md
-- =============================================================================

-- Last 10 digits of a phone number = customer identity key (legacy phoneKey_()).
create or replace function public.phone_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) > 10
             then right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
           else regexp_replace(coalesce(p, ''), '\D', '', 'g')
         end;
$$;

-- -----------------------------------------------------------------------------
-- Customers (master; one active row per phone key)
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  cust_code   text not null unique default private.next_code('CUST-'),
  name        text not null default '',
  company     text not null default '',
  phone       text not null default '',
  phone_key   text generated always as (public.phone_key(phone)) stored,
  email       text not null default '',
  gst         text not null default '',
  pincode     text not null default '',
  district    text not null default '',
  state       text not null default '',
  city        text not null default '',
  source      text not null default '',
  notes       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists customers_phone_key_active_uq
  on public.customers (phone_key) where active and phone_key <> '';
create index if not exists customers_search_trgm
  on public.customers using gin ((name || ' ' || company || ' ' || phone || ' ' || city) extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Enquiries (core transaction)
-- -----------------------------------------------------------------------------
create table if not exists public.enquiries (
  id               uuid primary key default gen_random_uuid(),
  enq_code         text not null unique default private.next_code('SETMI-ENQ-'),
  created_at       timestamptz not null default now(),
  enq_date         date not null,
  customer_id      uuid references public.customers (id) on delete restrict,
  customer_name    text not null check (length(btrim(customer_name)) > 0),
  company          text not null default '',
  phone            text not null default '',
  phone_key        text generated always as (public.phone_key(phone)) stored,
  email            text not null default '',
  gst              text not null default '',
  pincode          text not null default '',
  district         text not null default '',
  state            text not null default '',
  city             text not null default '',
  source           text not null default 'Other' references public.lead_sources (name) on update cascade,
  requirement      text not null default '',
  est_value        numeric(14,2) check (est_value is null or est_value >= 0),
  stage            text not null default 'New'
                   check (stage in ('New','Quoted','Follow-up','Won','Lost','Dispatched','Closed')),
  priority         text check (priority in ('Hot','Warm','Cold')),
  owner_id         uuid references public.team_members (id) on delete restrict,
  claimed_at       timestamptz,
  quote_no         text not null default '',
  quote_amount     numeric(14,2) check (quote_amount is null or quote_amount >= 0),
  quote_date       date,
  next_follow_up   date,
  last_contact     date,
  order_value      numeric(14,2) check (order_value is null or order_value >= 0),
  lost_reason      text not null default '',
  dispatch_date    date,
  dispatch_info    text not null default '',
  shipment_weight  numeric(10,2) check (shipment_weight is null or shipment_weight >= 0),
  feedback_rating  smallint check (feedback_rating between 1 and 5),
  feedback_note    text not null default '',
  notes            text not null default '',
  attachment_path  text not null default '',
  qty              numeric(14,2) check (qty is null or qty >= 0),
  timeline         text check (timeline in ('Immediate','Fortnight','Just Exploring')),
  grade            text check (grade in ('A','B','C')),
  escalation       text check (escalation in ('Proprietor','Shop Floor')),
  invoice_no       text not null default '',
  oms_order_id     text unique,
  active           boolean not null default true,
  archived_at      timestamptz,
  version          integer not null default 1,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  -- Terminal stages carry no priority / next follow-up (legacy moveStage + clearPriorityOnClosedStages).
  constraint enquiries_terminal_clears_followup check (
    stage in ('New','Quoted','Follow-up') or (priority is null and next_follow_up is null)
  )
);
create index if not exists enquiries_owner_stage_idx on public.enquiries (owner_id, stage) where active and archived_at is null;
create index if not exists enquiries_stage_idx       on public.enquiries (stage) where active and archived_at is null;
create index if not exists enquiries_next_fu_idx     on public.enquiries (next_follow_up) where active and archived_at is null and stage in ('New','Quoted','Follow-up');
create index if not exists enquiries_enq_date_idx    on public.enquiries (enq_date desc);
create index if not exists enquiries_source_idx      on public.enquiries (source);
create index if not exists enquiries_phone_key_idx   on public.enquiries (phone_key);
create index if not exists enquiries_customer_idx    on public.enquiries (customer_id);
create index if not exists enquiries_unclaimed_idx   on public.enquiries (created_at desc) where owner_id is null and active and archived_at is null;
create index if not exists enquiries_search_trgm
  on public.enquiries using gin ((customer_name || ' ' || company || ' ' || phone || ' ' || requirement || ' ' || city) extensions.gin_trgm_ops);

-- Stage history (new: the legacy sheet kept no transition log).
create table if not exists public.enquiry_stage_history (
  id          bigint generated always as identity primary key,
  enquiry_id  uuid not null references public.enquiries (id) on delete restrict,
  from_stage  text,
  to_stage    text not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references public.profiles (id) on delete set null,
  note        text not null default ''
);
create index if not exists stage_history_enquiry_idx on public.enquiry_stage_history (enquiry_id, changed_at);

-- -----------------------------------------------------------------------------
-- Pending approvals (intake queue)
-- -----------------------------------------------------------------------------
create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('bulk_file','meta_file','meta_sheet','legacy_migration')),
  file_name     text not null default '',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  total_rows    integer not null default 0,
  accepted      integer not null default 0,
  rejected      integer not null default 0,
  duplicates    integer not null default 0,
  report        jsonb not null default '{}'::jsonb
);

create table if not exists public.pending_enquiries (
  id                   uuid primary key default gen_random_uuid(),
  pend_code            text not null unique default private.next_code('PEND-'),
  created_at           timestamptz not null default now(),
  submitted_via        text not null check (submitted_via in ('staff','public_form','bulk_import','meta_import','legacy')),
  submitted_by         uuid references public.profiles (id) on delete set null,
  submitted_by_label   text not null default '',
  customer_name        text not null default '',
  company              text not null default '',
  phone                text not null default '',
  phone_key            text generated always as (public.phone_key(phone)) stored,
  email                text not null default '',
  gst                  text not null default '',
  pincode              text not null default '',
  district             text not null default '',
  state                text not null default '',
  city                 text not null default '',
  source               text not null default 'Other' references public.lead_sources (name) on update cascade,
  priority             text check (priority in ('Hot','Warm','Cold')),
  owner_id             uuid references public.team_members (id) on delete set null,
  est_value            numeric(14,2) check (est_value is null or est_value >= 0),
  requirement          text not null default '',
  qty                  numeric(14,2) check (qty is null or qty >= 0),
  timeline             text check (timeline in ('Immediate','Fortnight','Just Exploring')),
  notes                text not null default '',
  attachment_path      text not null default '',
  possible_duplicate   boolean not null default false,
  import_batch_id      uuid references public.import_batches (id) on delete set null,
  idempotency_key      text unique,
  status               text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  approved_enquiry_id  uuid unique references public.enquiries (id) on delete restrict,
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_by_label    text not null default '',
  reviewed_at          timestamptz,
  reject_reason        text not null default '',
  constraint pending_needs_contact check (length(btrim(customer_name)) > 0 or length(btrim(phone)) > 0),
  constraint pending_review_complete check (
    status = 'Pending'
    or (status = 'Approved' and approved_enquiry_id is not null and reviewed_at is not null)
    or (status = 'Rejected' and reviewed_at is not null and length(btrim(reject_reason)) > 0)
  )
);
create index if not exists pending_status_idx on public.pending_enquiries (status, created_at desc);
create index if not exists pending_phone_key_idx on public.pending_enquiries (phone_key);
create index if not exists pending_submitted_by_idx on public.pending_enquiries (submitted_by);

-- External lead identifiers (Meta lead ids, etc). Primary key = dedup guarantee.
create table if not exists public.external_lead_refs (
  source        text not null,
  external_id   text not null check (length(external_id) between 1 and 200),
  pending_id    uuid references public.pending_enquiries (id) on delete set null,
  enquiry_id    uuid references public.enquiries (id) on delete set null,
  batch_id      uuid references public.import_batches (id) on delete set null,
  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  primary key (source, external_id)
);

-- -----------------------------------------------------------------------------
-- Activity: follow-ups and structured calls
-- -----------------------------------------------------------------------------
create table if not exists public.follow_ups (
  id               uuid primary key default gen_random_uuid(),
  fu_code          text not null unique default private.next_code('FU-'),
  created_at       timestamptz not null default now(),
  enquiry_id       uuid not null references public.enquiries (id) on delete restrict,
  customer_name    text not null default '',
  mode             text not null default 'Note' check (mode in ('Call','Note')),
  outcome          text not null default '',
  next_follow_up   date,
  by_member_id     uuid references public.team_members (id) on delete set null,
  by_label         text not null default '',
  note             text not null default '',
  created_by       uuid references public.profiles (id) on delete set null
);
create index if not exists follow_ups_enquiry_idx on public.follow_ups (enquiry_id, created_at);
create index if not exists follow_ups_member_month_idx on public.follow_ups (by_member_id, created_at);

create table if not exists public.call_logs (
  id                  uuid primary key default gen_random_uuid(),
  call_code           text not null unique default private.next_code('CALL-'),
  created_at          timestamptz not null default now(),
  enquiry_id          uuid not null references public.enquiries (id) on delete restrict,
  customer_name       text not null default '',
  call_number         integer not null check (call_number >= 1),
  call_date           date not null,
  employee_member_id  uuid references public.team_members (id) on delete set null,
  employee_label      text not null default '',
  remarks             text not null default '',
  next_follow_up      date,
  call_status         text not null check (call_status in ('Connected','Not Connected','Busy','Switched Off','No Answer')),
  interest            text check (interest in ('Interested','Maybe / Thinking','Not Interested')),
  follow_up_id        uuid unique references public.follow_ups (id) on delete set null,
  client_request_id   uuid unique,
  created_by          uuid references public.profiles (id) on delete set null,
  constraint call_number_unique unique (enquiry_id, call_number),
  constraint interest_only_when_connected check (interest is null or call_status = 'Connected')
);
create index if not exists call_logs_member_date_idx on public.call_logs (employee_member_id, call_date);
create index if not exists call_logs_date_idx on public.call_logs (call_date);

-- -----------------------------------------------------------------------------
-- Lead transfers (owner proposes, receiver accepts)
-- -----------------------------------------------------------------------------
create table if not exists public.enquiry_transfers (
  id              uuid primary key default gen_random_uuid(),
  enquiry_id      uuid not null references public.enquiries (id) on delete restrict,
  from_member_id  uuid references public.team_members (id) on delete set null,
  to_member_id    uuid not null references public.team_members (id) on delete restrict,
  status          text not null default 'Proposed' check (status in ('Proposed','Accepted','Declined','Cancelled')),
  proposed_by     uuid references public.profiles (id) on delete set null,
  proposed_at     timestamptz not null default now(),
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz
);
create unique index if not exists one_open_transfer_per_enquiry
  on public.enquiry_transfers (enquiry_id) where status = 'Proposed';
create index if not exists transfers_to_idx on public.enquiry_transfers (to_member_id) where status = 'Proposed';

-- -----------------------------------------------------------------------------
-- OMS order requests (idempotency + audit for the OMS bridge)
-- -----------------------------------------------------------------------------
create table if not exists public.oms_order_requests (
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    uuid not null references public.enquiries (id) on delete restrict,
  request_key   uuid not null unique,
  status        text not null default 'started' check (status in ('started','succeeded','failed')),
  oms_order_id  text,
  error         text not null default '',
  payload       jsonb not null default '{}'::jsonb,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create unique index if not exists oms_one_success_per_enquiry
  on public.oms_order_requests (enquiry_id) where status in ('started','succeeded');

-- -----------------------------------------------------------------------------
-- Security / operations
-- -----------------------------------------------------------------------------
create table if not exists private.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_label  text not null default '',
  action       text not null,
  entity       text not null,
  entity_id    text not null default '',
  details      jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_entity_idx on private.audit_log (entity, entity_id, at desc);
create index if not exists audit_log_at_idx on private.audit_log (at desc);

-- Share links / API keys: only SHA-256 hashes are stored, never the token itself.
create table if not exists private.share_links (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('analysis')),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label         text not null default '',
  created_by    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  use_count     integer not null default 0
);

create table if not exists private.api_keys (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('public_metrics')),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label        text not null default '',
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

create table if not exists private.job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,
  run_key      text not null,
  status       text not null default 'running' check (status in ('running','succeeded','failed','skipped')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  details      jsonb not null default '{}'::jsonb,
  unique (job, run_key)
);

create table if not exists private.rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);
