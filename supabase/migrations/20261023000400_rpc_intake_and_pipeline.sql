-- =============================================================================
-- SETMI INDIA CRM — write RPCs: intake, approvals, ownership, pipeline, activity
--
-- Security model: every function here is SECURITY DEFINER with an empty
-- search_path and authorizes the caller itself (private.require_*). Clients have
-- NO direct insert/update/delete grants on any table (see 0600_security.sql), so
-- these functions are the only write path, whether called through the Next.js
-- server or directly through the Data API with a user JWT.
--
-- Errors: raise ... using hint = <code>, where code is one of
--   unauthenticated | forbidden | not_found | invalid | conflict | already_reviewed
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal: insert one enquiry row (used by approval and imports).
-- -----------------------------------------------------------------------------
create or replace function private.insert_enquiry(p jsonb, p_owner uuid, p_unclaimed boolean, p_actor uuid)
returns public.enquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
  v_priority text := case when p->>'priority' in ('Hot','Warm','Cold') then p->>'priority' else 'Warm' end;
  v_qty numeric := private.num_or_null(p->>'qty');
  v_timeline text := case when p->>'timeline' in ('Immediate','Fortnight','Just Exploring') then p->>'timeline' end;
  v_enq_date date := coalesce(nullif(p->>'enq_date', '')::date, private.today());
  v_customer uuid;
begin
  v_customer := private.upsert_customer(jsonb_build_object(
    'name', p->>'customer_name', 'company', p->>'company', 'phone', p->>'phone', 'email', p->>'email',
    'gst', p->>'gst', 'pincode', p->>'pincode', 'district', p->>'district', 'state', p->>'state',
    'city', p->>'city', 'source', p->>'source', 'notes', p->>'notes'), 'fill');

  insert into public.enquiries (
    enq_date, customer_id, customer_name, company, phone, email, gst, pincode, district, state, city,
    source, requirement, est_value, stage, priority, owner_id, claimed_at, next_follow_up,
    notes, attachment_path, qty, timeline, grade, updated_by)
  values (
    v_enq_date, v_customer,
    private.clean(p->>'customer_name', 120), private.clean(p->>'company', 120), private.clean(p->>'phone', 20),
    private.clean(p->>'email', 120), upper(private.clean(p->>'gst', 20)), private.clean(p->>'pincode', 10),
    private.clean(p->>'district', 80), private.clean(p->>'state', 80), private.clean(p->>'city', 80),
    private.valid_source(p->>'source'), private.clean(p->>'requirement', 1000),
    private.num_or_null(p->>'est_value'), 'New',
    case when p_unclaimed then null else v_priority end,
    case when p_unclaimed then null else p_owner end,
    case when p_unclaimed or p_owner is null then null else now() end,
    case when p_unclaimed then null else private.compute_next_follow_up(v_priority, v_enq_date) end,
    private.clean(p->>'notes', 4000), private.clean(p->>'attachment_path', 300),
    v_qty, v_timeline, private.grade_for(v_qty, v_timeline), p_actor)
  returning * into e;

  insert into public.enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note)
  values (e.id, null, 'New', p_actor, 'created');
  return e;
end;
$$;

create or replace function private.validate_contact(p jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if length(btrim(coalesce(p->>'customer_name', ''))) = 0 then
    raise exception 'Customer name is required' using errcode = 'P0001', hint = 'invalid';
  end if;
  if length(public.phone_key(p->>'phone')) <> 10 then
    raise exception 'Phone must have 10 digits' using errcode = 'P0001', hint = 'invalid';
  end if;
  if coalesce(p->>'email', '') <> '' and (p->>'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001', hint = 'invalid';
  end if;
  if coalesce(p->>'pincode', '') <> '' and (p->>'pincode') !~ '^[0-9]{6}$' then
    raise exception 'Pincode must be 6 digits' using errcode = 'P0001', hint = 'invalid';
  end if;
  if coalesce(p->>'gst', '') <> ''
     and upper(p->>'gst') !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Invalid GSTIN' using errcode = 'P0001', hint = 'invalid';
  end if;
end;
$$;

create or replace function private.is_possible_duplicate(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.phone_key(p_phone) <> '' and (
    exists (select 1 from public.enquiries e where e.phone_key = public.phone_key(p_phone) and e.active)
    or exists (select 1 from public.pending_enquiries pe where pe.phone_key = public.phone_key(p_phone) and pe.status = 'Pending'))
$$;

create or replace function private.insert_pending(p jsonb, p_via text, p_by uuid, p_label text, p_batch uuid, p_idem text)
returns public.pending_enquiries
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.pending_enquiries;
  v_owner uuid;
  v_qty numeric := private.num_or_null(p->>'qty');
begin
  if coalesce(p->>'owner_id', '') <> '' then
    select id into v_owner from public.team_members where id = (p->>'owner_id')::uuid and active;
    if v_owner is null then
      raise exception 'Lead By must be an active team member' using errcode = 'P0001', hint = 'invalid';
    end if;
  end if;
  insert into public.pending_enquiries (
    submitted_via, submitted_by, submitted_by_label, customer_name, company, phone, email, gst, pincode,
    district, state, city, source, priority, owner_id, est_value, requirement, qty, timeline, notes,
    attachment_path, possible_duplicate, import_batch_id, idempotency_key)
  values (
    p_via, p_by, private.clean(p_label, 120),
    private.clean(p->>'customer_name', 120), private.clean(p->>'company', 120), private.clean(p->>'phone', 20),
    private.clean(p->>'email', 120), upper(private.clean(p->>'gst', 20)), private.clean(p->>'pincode', 10),
    private.clean(p->>'district', 80), private.clean(p->>'state', 80), private.clean(p->>'city', 80),
    private.valid_source(p->>'source'),
    case when p->>'priority' in ('Hot','Warm','Cold') then p->>'priority' else 'Warm' end,
    v_owner, private.num_or_null(p->>'est_value'), private.clean(p->>'requirement', 1000),
    v_qty, case when p->>'timeline' in ('Immediate','Fortnight','Just Exploring') then p->>'timeline' end,
    private.clean(p->>'notes', 4000), private.clean(p->>'attachment_path', 300),
    private.is_possible_duplicate(p->>'phone'), p_batch, p_idem)
  returning * into r;
  return r;
end;
$$;

-- -----------------------------------------------------------------------------
-- Intake → Pending Approvals
-- -----------------------------------------------------------------------------
-- Staff "New Enquiry" form (legacy submitPendingEnquiry).
create or replace function public.create_pending_enquiry(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  r public.pending_enquiries;
begin
  perform private.validate_contact(p);
  r := private.insert_pending(p, 'staff', me.id, me.full_name, null, null);
  perform private.audit('pending.create', 'pending_enquiry', r.pend_code, jsonb_build_object('via', 'staff'));
  return jsonb_build_object('id', r.id, 'code', r.pend_code, 'possible_duplicate', r.possible_duplicate);
end;
$$;

-- Public field form (legacy submitFieldEnquiry). Server-only (service_role): the
-- Next.js route validates, rate-limits and passes an idempotency key. Only the
-- allow-listed fields below are read; owner/priority/source cannot be injected.
create or replace function public.submit_public_enquiry(p jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.pending_enquiries;
  safe jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 100 then
    raise exception 'Missing idempotency key' using errcode = 'P0001', hint = 'invalid';
  end if;
  select * into r from public.pending_enquiries where idempotency_key = p_idempotency_key;
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'code', r.pend_code, 'duplicate_submission', true);
  end if;
  safe := jsonb_build_object(
    'customer_name', p->>'customer_name', 'company', p->>'company', 'phone', p->>'phone',
    'email', p->>'email', 'pincode', p->>'pincode', 'district', p->>'district', 'state', p->>'state',
    'city', p->>'city', 'requirement', p->>'requirement', 'qty', p->>'qty', 'timeline', p->>'timeline',
    'source', 'Website');
  perform private.validate_contact(safe);
  r := private.insert_pending(safe, 'public_form', null, 'Public enquiry form', null, p_idempotency_key);
  perform private.audit('pending.create', 'pending_enquiry', r.pend_code, jsonb_build_object('via', 'public_form'));
  return jsonb_build_object('id', r.id, 'code', r.pend_code, 'duplicate_submission', false);
end;
$$;

-- Bulk CSV/Excel import (legacy submitBulkPendingFromRows). Every row lands in Pending.
create or replace function public.bulk_create_pending(p_rows jsonb, p_file_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  b public.import_batches;
  row_ jsonb;
  i integer := 0;
  n_accepted integer := 0;
  n_rejected integer := 0;
  dup integer := 0;
  seen text[] := '{}';
  sig text;
  errors jsonb := '[]'::jsonb;
  req text;
  r public.pending_enquiries;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to import' using errcode = 'P0001', hint = 'invalid';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Too many rows (max 2000 per file)' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into public.import_batches (kind, file_name, created_by, total_rows)
  values ('bulk_file', private.clean(p_file_name, 200), me.id, jsonb_array_length(p_rows))
  returning * into b;

  for row_ in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    if length(btrim(coalesce(row_->>'name', ''))) = 0 and length(public.phone_key(row_->>'phone')) = 0 then
      n_rejected := n_rejected + 1;
      errors := errors || jsonb_build_object('row', i, 'error', 'needs a name or phone');
      continue;
    end if;
    if length(public.phone_key(row_->>'phone')) not in (0, 10) then
      n_rejected := n_rejected + 1;
      errors := errors || jsonb_build_object('row', i, 'error', 'phone must have 10 digits');
      continue;
    end if;
    req := concat_ws(' — ', nullif(btrim(coalesce(row_->>'requirement', '')), ''), nullif(btrim(coalesce(row_->>'quantity', '')), ''));
    sig := public.phone_key(row_->>'phone') || '|' || lower(req) || '|' || lower(btrim(coalesce(row_->>'name', '')));
    if sig = any (seen) then
      dup := dup + 1;
      errors := errors || jsonb_build_object('row', i, 'error', 'duplicate of an earlier row in this file');
      continue;
    end if;
    seen := seen || sig;
    r := private.insert_pending(jsonb_build_object(
          'customer_name', coalesce(nullif(btrim(row_->>'name'), ''), '(no name)'),
          'company', row_->>'company', 'phone', row_->>'phone', 'source', row_->>'source',
          'priority', row_->>'priority', 'owner_id', row_->>'owner_id', 'requirement', req,
          'notes', 'Bulk imported from CSV/Excel — verify before approving'
                   || case when btrim(coalesce(row_->>'remark', '')) <> '' then ' | Remark: ' || btrim(row_->>'remark') else '' end),
        'bulk_import', me.id, me.full_name, b.id, null);
    n_accepted := n_accepted + 1;
  end loop;

  update public.import_batches
     set accepted = n_accepted, rejected = n_rejected,
         duplicates = dup, report = jsonb_build_object('errors', errors)
   where id = b.id;
  perform private.audit('import.bulk', 'import_batch', b.id::text,
    jsonb_build_object('accepted', n_accepted, 'rejected', n_rejected, 'duplicates', dup));
  return jsonb_build_object('batch_id', b.id, 'accepted', n_accepted, 'rejected', n_rejected,
                            'duplicates', dup, 'errors', errors);
end;
$$;

-- Fix a field on a still-Pending row (legacy updatePendingEnquiry). Admin or the submitter.
create or replace function public.update_pending_enquiry(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  r public.pending_enquiries;
  v_owner uuid;
begin
  select * into r from public.pending_enquiries where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if me.role <> 'admin' and r.submitted_by is distinct from me.id then
    raise exception 'Only admins or the submitter can edit this' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if r.status <> 'Pending' then
    raise exception 'Already reviewed — cannot edit' using errcode = 'P0001', hint = 'already_reviewed';
  end if;
  perform private.validate_contact(p);
  if coalesce(p->>'owner_id', '') <> '' then
    select id into v_owner from public.team_members where id = (p->>'owner_id')::uuid and active;
    if v_owner is null then raise exception 'Lead By must be an active team member' using errcode = 'P0001', hint = 'invalid'; end if;
  end if;
  update public.pending_enquiries set
    customer_name = private.clean(p->>'customer_name', 120), company = private.clean(p->>'company', 120),
    phone = private.clean(p->>'phone', 20), email = private.clean(p->>'email', 120),
    gst = upper(private.clean(p->>'gst', 20)), pincode = private.clean(p->>'pincode', 10),
    district = private.clean(p->>'district', 80), state = private.clean(p->>'state', 80),
    city = private.clean(p->>'city', 80), source = private.valid_source(p->>'source'),
    priority = case when p->>'priority' in ('Hot','Warm','Cold') then p->>'priority' else priority end,
    owner_id = v_owner, est_value = private.num_or_null(p->>'est_value'),
    requirement = private.clean(p->>'requirement', 1000), notes = private.clean(p->>'notes', 4000),
    qty = private.num_or_null(p->>'qty'),
    timeline = case when p->>'timeline' in ('Immediate','Fortnight','Just Exploring') then p->>'timeline' end,
    possible_duplicate = private.is_possible_duplicate(p->>'phone')
  where id = p_id;
  perform private.audit('pending.update', 'pending_enquiry', r.pend_code, '{}'::jsonb);
end;
$$;

-- Approve (legacy approvePendingEnquiry). Admin-only (resolves BUG-011).
-- Idempotent: approving an already-approved row returns the enquiry it created.
create or replace function public.approve_pending(p_id uuid, p_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_admin();
  r public.pending_enquiries;
  e public.enquiries;
  v_owner uuid;
begin
  select * into r from public.pending_enquiries where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if r.status = 'Approved' then
    select * into e from public.enquiries where id = r.approved_enquiry_id;
    return jsonb_build_object('enquiry_id', e.id, 'code', e.enq_code, 'already_approved', true);
  end if;
  if r.status <> 'Pending' then
    raise exception 'Already reviewed' using errcode = 'P0001', hint = 'already_reviewed';
  end if;
  v_owner := coalesce(p_owner, r.owner_id);
  if v_owner is not null and not exists (select 1 from public.team_members where id = v_owner and active) then
    raise exception 'Lead By must be an active team member' using errcode = 'P0001', hint = 'invalid';
  end if;
  -- No owner chosen → the lead stays unclaimed and appears on Available Leads (legacy leaveUnclaimed).
  e := private.insert_enquiry(jsonb_build_object(
        'customer_name', r.customer_name, 'company', r.company, 'phone', r.phone, 'email', r.email,
        'gst', r.gst, 'pincode', r.pincode, 'district', r.district, 'state', r.state, 'city', r.city,
        'source', r.source, 'priority', r.priority, 'est_value', r.est_value::text,
        'requirement', r.requirement, 'notes', r.notes, 'attachment_path', r.attachment_path,
        'qty', r.qty::text, 'timeline', r.timeline),
       v_owner, v_owner is null, me.id);
  update public.pending_enquiries
     set status = 'Approved', approved_enquiry_id = e.id, reviewed_by = me.id,
         reviewed_by_label = me.full_name, reviewed_at = now()
   where id = p_id;
  update public.external_lead_refs set enquiry_id = e.id where pending_id = p_id;
  perform private.audit('pending.approve', 'pending_enquiry', r.pend_code, jsonb_build_object('enquiry', e.enq_code));
  return jsonb_build_object('enquiry_id', e.id, 'code', e.enq_code, 'already_approved', false);
end;
$$;

create or replace function public.reject_pending(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_admin();
  r public.pending_enquiries;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A rejection reason is required' using errcode = 'P0001', hint = 'invalid';
  end if;
  select * into r from public.pending_enquiries where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if r.status <> 'Pending' then raise exception 'Already reviewed' using errcode = 'P0001', hint = 'already_reviewed'; end if;
  update public.pending_enquiries
     set status = 'Rejected', reject_reason = private.clean(p_reason, 500), reviewed_by = me.id,
         reviewed_by_label = me.full_name, reviewed_at = now()
   where id = p_id;
  perform private.audit('pending.reject', 'pending_enquiry', r.pend_code, jsonb_build_object('reason', private.clean(p_reason, 500)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Ownership: claim and transfer
-- -----------------------------------------------------------------------------
create or replace function public.claim_enquiry(p_id uuid, p_priority text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  my_member uuid := private.current_member_id();
  e public.enquiries;
  owner_name text;
begin
  if my_member is null then
    raise exception 'Your login is not linked to a team member' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_priority is not null and p_priority not in ('Hot','Warm','Cold') then
    raise exception 'Invalid priority' using errcode = 'P0001', hint = 'invalid';
  end if;
  select * into e from public.enquiries where id = p_id and active and archived_at is null for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if e.owner_id is not null then
    select name into owner_name from public.team_members where id = e.owner_id;
    raise exception 'Already claimed by %', owner_name using errcode = 'P0001', hint = 'conflict';
  end if;
  if e.stage not in ('New','Quoted','Follow-up') then
    raise exception 'Only open enquiries can be claimed' using errcode = 'P0001', hint = 'invalid';
  end if;
  update public.enquiries set
    owner_id = my_member,
    claimed_at = now(),
    priority = coalesce(p_priority, priority),
    next_follow_up = case when next_follow_up is null and p_priority is not null
                          then private.compute_next_follow_up(p_priority, private.today())
                          else next_follow_up end,
    version = version + 1, updated_at = now(), updated_by = me.id
  where id = p_id;
  perform private.audit('enquiry.claim', 'enquiry', e.enq_code, jsonb_build_object('priority', p_priority));
  return jsonb_build_object('ok', true, 'code', e.enq_code);
end;
$$;

create or replace function public.propose_transfer(p_id uuid, p_to_member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  e public.enquiries;
  t_id uuid;
begin
  select * into e from public.enquiries where id = p_id and active and archived_at is null for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);
  if not exists (select 1 from public.team_members where id = p_to_member and active) then
    raise exception 'Pick an active team member' using errcode = 'P0001', hint = 'invalid';
  end if;
  if p_to_member = e.owner_id then
    raise exception 'Lead already belongs to them' using errcode = 'P0001', hint = 'invalid';
  end if;
  if exists (select 1 from public.enquiry_transfers where enquiry_id = p_id and status = 'Proposed') then
    raise exception 'A transfer is already pending for this lead' using errcode = 'P0001', hint = 'conflict';
  end if;
  insert into public.enquiry_transfers (enquiry_id, from_member_id, to_member_id, proposed_by)
  values (p_id, e.owner_id, p_to_member, me.id) returning id into t_id;
  perform private.audit('transfer.propose', 'enquiry', e.enq_code, jsonb_build_object('to', p_to_member));
  return t_id;
end;
$$;

create or replace function public.respond_transfer(p_transfer_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  t public.enquiry_transfers;
  e public.enquiries;
begin
  select * into t from public.enquiry_transfers where id = p_transfer_id for update;
  if t.id is null or t.status <> 'Proposed' then
    raise exception 'No pending transfer found' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_admin() and t.to_member_id is distinct from private.current_member_id() then
    raise exception 'This transfer is not addressed to you' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select * into e from public.enquiries where id = t.enquiry_id for update;
  if p_accept then
    if e.owner_id is distinct from t.from_member_id then
      update public.enquiry_transfers set status = 'Cancelled', decided_by = me.id, decided_at = now() where id = t.id;
      raise exception 'The lead changed owner since this transfer was proposed' using errcode = 'P0001', hint = 'conflict';
    end if;
    update public.enquiries set owner_id = t.to_member_id, claimed_at = now(), version = version + 1,
           updated_at = now(), updated_by = me.id
     where id = e.id;
  end if;
  update public.enquiry_transfers
     set status = case when p_accept then 'Accepted' else 'Declined' end, decided_by = me.id, decided_at = now()
   where id = t.id;
  perform private.audit(case when p_accept then 'transfer.accept' else 'transfer.decline' end, 'enquiry', e.enq_code, '{}'::jsonb);
end;
$$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  t public.enquiry_transfers;
begin
  select * into t from public.enquiry_transfers where id = p_transfer_id for update;
  if t.id is null or t.status <> 'Proposed' then
    raise exception 'No pending transfer found' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_admin() and t.from_member_id is distinct from private.current_member_id() then
    raise exception 'Only the current owner can cancel' using errcode = 'P0001', hint = 'forbidden';
  end if;
  update public.enquiry_transfers set status = 'Cancelled', decided_by = me.id, decided_at = now() where id = t.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Edit enquiry (legacy editEnquiry) with optimistic concurrency (fixes BUG-004)
-- -----------------------------------------------------------------------------
create or replace function public.update_enquiry(p_id uuid, p jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  admin_ boolean := private.is_admin();
  e public.enquiries;
  v_priority text;
  v_owner uuid;
  v_next date;
  v_qty numeric;
  v_timeline text;
  v_escalation text;
  v_ver integer;
begin
  select * into e from public.enquiries where id = p_id and active for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);
  if p_expected_version is not null and p_expected_version <> e.version then
    raise exception 'This enquiry was changed by someone else — reload and try again' using errcode = 'P0001', hint = 'conflict';
  end if;
  perform private.validate_contact(jsonb_build_object(
    'customer_name', coalesce(p->>'customer_name', e.customer_name), 'phone', coalesce(p->>'phone', e.phone),
    'email', coalesce(p->>'email', e.email), 'pincode', coalesce(p->>'pincode', e.pincode),
    'gst', coalesce(p->>'gst', e.gst)));

  -- Reassignment is admin-only; reps hand over through propose_transfer (resolves BUG-010).
  v_owner := e.owner_id;
  if p ? 'owner_id' and (p->>'owner_id') is distinct from e.owner_id::text then
    if not admin_ then
      raise exception 'Use Transfer to hand a lead to someone else' using errcode = 'P0001', hint = 'forbidden';
    end if;
    v_owner := nullif(p->>'owner_id', '')::uuid;
    if v_owner is not null and not exists (select 1 from public.team_members where id = v_owner and active) then
      raise exception 'Lead By must be an active team member' using errcode = 'P0001', hint = 'invalid';
    end if;
  end if;

  v_priority := case when p->>'priority' in ('Hot','Warm','Cold') then p->>'priority' else e.priority end;
  if e.stage not in ('New','Quoted','Follow-up') then v_priority := null; end if;
  v_qty := case when p ? 'qty' then private.num_or_null(p->>'qty') else e.qty end;
  v_timeline := case when p ? 'timeline' then
                  case when p->>'timeline' in ('Immediate','Fortnight','Just Exploring') then p->>'timeline' end
                else e.timeline end;
  v_escalation := case when p ? 'escalation' then
                    case when p->>'escalation' in ('Proprietor','Shop Floor') then p->>'escalation' end
                  else e.escalation end;

  -- Next follow-up: explicit date wins; a priority change with the date untouched recomputes
  -- from LastContact/EnqDate; terminal stages never get a date back.
  v_next := e.next_follow_up;
  if e.stage in ('New','Quoted','Follow-up') then
    if p ? 'next_follow_up' and nullif(p->>'next_follow_up', '')::date is distinct from e.next_follow_up then
      v_next := nullif(p->>'next_follow_up', '')::date;
    elsif v_priority is distinct from e.priority and v_priority is not null then
      v_next := private.compute_next_follow_up(v_priority, coalesce(e.last_contact, e.enq_date));
    end if;
  else
    v_next := null;
  end if;

  update public.enquiries set
    customer_name = case when p ? 'customer_name' then private.clean(p->>'customer_name', 120) else customer_name end,
    company  = case when p ? 'company'  then private.clean(p->>'company', 120) else company end,
    phone    = coalesce(nullif(private.clean(p->>'phone', 20), ''), phone),
    email    = case when p ? 'email'    then private.clean(p->>'email', 120) else email end,
    gst      = case when p ? 'gst'      then upper(private.clean(p->>'gst', 20)) else gst end,
    pincode  = case when p ? 'pincode'  then private.clean(p->>'pincode', 10) else pincode end,
    district = case when p ? 'district' then private.clean(p->>'district', 80) else district end,
    state    = case when p ? 'state'    then private.clean(p->>'state', 80) else state end,
    city     = case when p ? 'city'     then private.clean(p->>'city', 80) else city end,
    source   = case when p ? 'source'   then private.valid_source(p->>'source') else source end,
    requirement = case when p ? 'requirement' then private.clean(p->>'requirement', 1000) else requirement end,
    est_value   = case when p ? 'est_value' then private.num_or_null(p->>'est_value') else est_value end,
    quote_amount = case when p ? 'quote_amount' then private.num_or_null(p->>'quote_amount') else quote_amount end,
    order_value  = case when p ? 'order_value' then private.num_or_null(p->>'order_value') else order_value end,
    shipment_weight = case when p ? 'shipment_weight' then private.num_or_null(p->>'shipment_weight') else shipment_weight end,
    priority = v_priority,
    owner_id = v_owner,
    claimed_at = case when v_owner is distinct from e.owner_id and v_owner is not null then now() else claimed_at end,
    next_follow_up = v_next,
    qty = v_qty, timeline = v_timeline, grade = private.grade_for(v_qty, v_timeline), escalation = v_escalation,
    version = version + 1, updated_at = now(), updated_by = me.id
  where id = p_id
  returning version into v_ver;

  -- Customer master correction cascades (legacy upsertCustomerOverwrite_ + syncEnquiriesForCustomer_).
  if e.customer_id is not null and (p ?| array['customer_name','company','phone','email','gst','pincode','district','state','city']) then
    begin
      update public.customers c set
        name = en.customer_name, company = en.company, phone = en.phone, email = en.email, gst = en.gst,
        pincode = en.pincode, district = en.district, state = en.state, city = en.city, updated_at = now()
      from public.enquiries en where en.id = p_id and c.id = e.customer_id;
    exception when unique_violation then
      raise exception 'Another customer already uses this phone number' using errcode = 'P0001', hint = 'conflict';
    end;
    update public.enquiries o set
      customer_name = en.customer_name, company = en.company, phone = en.phone, email = en.email, gst = en.gst,
      pincode = en.pincode, district = en.district, state = en.state, city = en.city,
      version = o.version + 1, updated_at = now()
    from public.enquiries en
    where en.id = p_id and o.customer_id = e.customer_id and o.id <> p_id;
  end if;

  perform private.audit('enquiry.update', 'enquiry', e.enq_code,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return v_ver;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pipeline transitions (legacy moveStage) — validated (fixes BUG-009)
-- -----------------------------------------------------------------------------
create or replace function private.do_move_stage(p_id uuid, p_stage text, p jsonb, p_expected_version integer, p_from_oms boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me_id uuid := auth.uid();
  e public.enquiries;
  today_ date := private.today();
  v_ver integer;
  v_note text := private.clean(p->>'note', 1000);
  v_invoice text := private.clean(p->>'invoice_no', 60);
  v_rating smallint;
begin
  select * into e from public.enquiries where id = p_id and active and archived_at is null for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if not p_from_oms then
    perform private.require_owner_or_admin(e.owner_id);
  end if;
  if p_expected_version is not null and p_expected_version <> e.version then
    raise exception 'This enquiry was changed by someone else — reload and try again' using errcode = 'P0001', hint = 'conflict';
  end if;
  if p_stage not in ('New','Quoted','Follow-up','Won','Lost','Dispatched','Closed') then
    raise exception 'Invalid stage' using errcode = 'P0001', hint = 'invalid';
  end if;
  if not private.stage_transition_allowed(e.stage, p_stage, private.is_admin()) then
    raise exception 'Cannot move from % to %', e.stage, p_stage using errcode = 'P0001', hint = 'invalid';
  end if;

  if p_stage = 'Won' and v_invoice = '' and not p_from_oms then
    raise exception 'Invoice number is required to mark Won' using errcode = 'P0001', hint = 'invalid';
  end if;
  if p_stage = 'Lost' and length(btrim(coalesce(p->>'lost_reason', ''))) = 0 then
    raise exception 'Lost reason is required' using errcode = 'P0001', hint = 'invalid';
  end if;
  if p_stage = 'Closed' and coalesce(p->>'feedback_rating', '') <> '' then
    v_rating := (p->>'feedback_rating')::smallint;
    if v_rating not between 1 and 5 then
      raise exception 'Rating must be 1–5' using errcode = 'P0001', hint = 'invalid';
    end if;
  end if;

  update public.enquiries set
    stage = p_stage,
    last_contact = today_,
    quote_no = case when p_stage = 'Quoted' and p ? 'quote_no' then private.clean(p->>'quote_no', 60) else quote_no end,
    quote_amount = case when p_stage = 'Quoted' and p ? 'quote_amount' then private.num_or_null(p->>'quote_amount') else quote_amount end,
    quote_date = case when p_stage = 'Quoted' then today_ else quote_date end,
    invoice_no = case when p_stage = 'Won' and v_invoice <> '' then v_invoice else invoice_no end,
    order_value = case when p_stage = 'Won' and p ? 'order_value' then private.num_or_null(p->>'order_value') else order_value end,
    lost_reason = case when p_stage = 'Lost' then private.clean(p->>'lost_reason', 500) else lost_reason end,
    dispatch_date = case when p_stage = 'Dispatched' then coalesce(nullif(p->>'dispatch_date', '')::date, today_) else dispatch_date end,
    dispatch_info = case when p_stage = 'Dispatched' then private.clean(p->>'dispatch_info', 500) else dispatch_info end,
    shipment_weight = case when p_stage = 'Dispatched' then private.num_or_null(p->>'shipment_weight') else shipment_weight end,
    feedback_rating = case when p_stage = 'Closed' and v_rating is not null then v_rating else feedback_rating end,
    feedback_note = case when p_stage = 'Closed' and p ? 'feedback_note' then private.clean(p->>'feedback_note', 1000) else feedback_note end,
    priority = case when p_stage in ('Won','Lost','Dispatched','Closed') then null
                    when e.stage = 'Lost' then coalesce(e.priority, 'Warm') else priority end,
    next_follow_up = case
      when p_stage in ('Won','Lost','Dispatched','Closed') then null
      when p_stage in ('Quoted','Follow-up') then coalesce(nullif(p->>'next_follow_up', '')::date,
                       private.compute_next_follow_up(coalesce(e.priority, 'Warm'), today_))
      else next_follow_up end,
    notes = case when v_note <> '' then
              case when notes = '' then '' else notes || ' | ' end || to_char(today_, 'YYYY-MM-DD') || ': ' || v_note
            else notes end,
    version = version + 1, updated_at = now(), updated_by = me_id
  where id = p_id
  returning version into v_ver;

  insert into public.enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note)
  values (p_id, e.stage, p_stage, me_id, v_note);
  perform private.audit('enquiry.stage', 'enquiry', e.enq_code, jsonb_build_object('from', e.stage, 'to', p_stage));
  return v_ver;
end;
$$;

create or replace function public.move_stage(p_id uuid, p_stage text, p jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return private.do_move_stage(p_id, p_stage, coalesce(p, '{}'::jsonb), p_expected_version, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Activity: structured call (legacy logCall + writeNote_), atomic in one transaction.
-- -----------------------------------------------------------------------------
create or replace function public.log_call(p_enquiry_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  my_member uuid := private.current_member_id();
  e public.enquiries;
  existing public.call_logs;
  v_status text := p->>'call_status';
  v_interest text;
  v_date date := coalesce(nullif(p->>'call_date', '')::date, private.today());
  v_next date := nullif(p->>'next_follow_up', '')::date;
  v_remarks text := private.clean(p->>'remarks', 1000);
  v_req uuid := nullif(p->>'client_request_id', '')::uuid;
  v_num integer;
  fu_id uuid;
  c public.call_logs;
  soft_limit integer;
begin
  if v_req is not null then
    select * into existing from public.call_logs where client_request_id = v_req;
    if existing.id is not null then
      return jsonb_build_object('call_number', existing.call_number, 'code', existing.call_code, 'duplicate', true);
    end if;
  end if;
  if v_status is null or v_status not in ('Connected','Not Connected','Busy','Switched Off','No Answer') then
    raise exception 'Pick a call status' using errcode = 'P0001', hint = 'invalid';
  end if;
  v_interest := case when v_status = 'Connected' and p->>'interest' in ('Interested','Maybe / Thinking','Not Interested')
                     then p->>'interest' end;
  if v_date > private.today() then
    raise exception 'Call date cannot be in the future' using errcode = 'P0001', hint = 'invalid';
  end if;
  if v_date < private.today() - 60 then
    raise exception 'Call date is too far in the past' using errcode = 'P0001', hint = 'invalid';
  end if;
  if v_next is not null and v_next < v_date then
    raise exception 'Next follow-up cannot be before the call date' using errcode = 'P0001', hint = 'invalid';
  end if;

  select * into e from public.enquiries where id = p_enquiry_id and active and archived_at is null for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);

  if e.stage in ('New','Quoted','Follow-up') and v_next is null then
    v_next := private.compute_next_follow_up(coalesce(e.priority, 'Warm'), v_date);
  end if;
  if e.stage not in ('New','Quoted','Follow-up') then
    v_next := null;
  end if;

  update public.enquiries set
    last_contact = greatest(coalesce(last_contact, v_date), v_date),
    next_follow_up = case when stage in ('New','Quoted','Follow-up') then v_next else null end,
    stage = case when stage in ('New','Quoted') then 'Follow-up' else stage end,
    version = version + 1, updated_at = now(), updated_by = me.id
  where id = e.id;
  if e.stage in ('New','Quoted') then
    insert into public.enquiry_stage_history (enquiry_id, from_stage, to_stage, changed_by, note)
    values (e.id, e.stage, 'Follow-up', me.id, 'call logged');
  end if;

  insert into public.follow_ups (enquiry_id, customer_name, mode, outcome, next_follow_up, by_member_id, by_label, note, created_by)
  values (e.id, e.customer_name, 'Call',
          concat_ws(' — ', v_status, v_interest, nullif(v_remarks, '')),
          v_next, my_member, me.full_name, v_remarks, me.id)
  returning id into fu_id;

  select coalesce(max(call_number), 0) + 1 into v_num from public.call_logs where enquiry_id = e.id;
  insert into public.call_logs (enquiry_id, customer_name, call_number, call_date, employee_member_id, employee_label,
                                remarks, next_follow_up, call_status, interest, follow_up_id, client_request_id, created_by)
  values (e.id, e.customer_name, v_num, v_date, my_member, me.full_name, v_remarks, v_next, v_status, v_interest,
          fu_id, v_req, me.id)
  returning * into c;

  select (value #>> '{}')::integer into soft_limit from private.app_settings where key = 'calls_soft_limit';
  return jsonb_build_object('call_number', c.call_number, 'code', c.call_code, 'duplicate', false,
                            'over_soft_limit', c.call_number > coalesce(soft_limit, 6));
end;
$$;

create or replace function public.add_note(p_enquiry_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  e public.enquiries;
begin
  if length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Note is empty' using errcode = 'P0001', hint = 'invalid';
  end if;
  select * into e from public.enquiries where id = p_enquiry_id and active for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);
  insert into public.follow_ups (enquiry_id, customer_name, mode, by_member_id, by_label, note, created_by)
  values (e.id, e.customer_name, 'Note', private.current_member_id(), me.full_name, private.clean(p_note, 2000), me.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Soft delete / restore / archive (legacy deleteEnquiry, Archive menu tools)
-- -----------------------------------------------------------------------------
create or replace function public.soft_delete_enquiry(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
begin
  perform private.require_user();
  select * into e from public.enquiries where id = p_id and active for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);
  update public.enquiries set active = false, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_id;
  update public.enquiry_transfers set status = 'Cancelled', decided_at = now(), decided_by = auth.uid()
   where enquiry_id = p_id and status = 'Proposed';
  perform private.audit('enquiry.delete', 'enquiry', e.enq_code, jsonb_build_object('reason', private.clean(p_reason, 300)));
end;
$$;

create or replace function public.restore_enquiry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
begin
  perform private.require_admin();
  update public.enquiries set active = true, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_id and not active returning * into e;
  if e.id is null then raise exception 'Deleted enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.audit('enquiry.restore', 'enquiry', e.enq_code, '{}'::jsonb);
end;
$$;

-- Archive closed-out enquiries older than N months (legacy ARCHIVE_CLOSED_STAGES_ / archiveRefDate_).
-- Rows stay in place with archived_at set — no positional copy, so BUG-002 cannot occur.
create or replace function public.archive_closed_enquiries(p_months integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  months integer;
begin
  perform private.require_admin();
  select coalesce(p_months, (value #>> '{}')::integer, 6) into months from private.app_settings where key = 'archive_after_months';
  if months < 1 then raise exception 'Months must be at least 1' using errcode = 'P0001', hint = 'invalid'; end if;
  update public.enquiries set archived_at = now(), version = version + 1
   where archived_at is null and active and stage in ('Won','Lost','Dispatched','Closed')
     and coalesce(dispatch_date, last_contact, enq_date) < private.today() - make_interval(months => months);
  get diagnostics n = row_count;
  perform private.audit('enquiry.archive', 'enquiry', '', jsonb_build_object('count', n, 'months', months));
  return n;
end;
$$;

create or replace function public.restore_archived_enquiry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.enquiries;
begin
  perform private.require_admin();
  update public.enquiries set archived_at = null, version = version + 1 where id = p_id and archived_at is not null returning * into e;
  if e.id is null then raise exception 'Archived enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.audit('enquiry.unarchive', 'enquiry', e.enq_code, '{}'::jsonb);
end;
$$;
