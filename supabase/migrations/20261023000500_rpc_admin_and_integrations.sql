-- =============================================================================
-- SETMI INDIA CRM — customers, team/users, settings, integrations
-- Functions marked "service_role only" are granted to service_role alone in
-- 0600_security.sql; the Next.js server calls them after its own checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Customers (legacy addCustomer / editCustomer)
-- -----------------------------------------------------------------------------
create or replace function public.create_customer(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_ uuid;
begin
  perform private.require_user();
  perform private.validate_contact(jsonb_build_object('customer_name', p->>'name', 'phone', p->>'phone',
    'email', p->>'email', 'pincode', p->>'pincode', 'gst', p->>'gst'));
  id_ := private.upsert_customer(p, 'fill');
  perform private.audit('customer.create', 'customer', id_::text, '{}'::jsonb);
  return id_;
end;
$$;

-- Admin, or a rep who owns at least one enquiry of this customer. Contact changes
-- cascade to every enquiry linked to the customer (legacy syncEnquiriesForCustomer_).
create or replace function public.update_customer(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
begin
  perform private.require_user();
  select * into c from public.customers where id = p_id and active for update;
  if c.id is null then raise exception 'Customer not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if not private.is_admin() and not exists (
       select 1 from public.enquiries e where e.customer_id = p_id and e.owner_id = private.current_member_id()) then
    raise exception 'You can only edit customers of your own leads' using errcode = 'P0001', hint = 'forbidden';
  end if;
  perform private.validate_contact(jsonb_build_object('customer_name', coalesce(p->>'name', c.name),
    'phone', coalesce(p->>'phone', c.phone), 'email', coalesce(p->>'email', c.email),
    'pincode', coalesce(p->>'pincode', c.pincode), 'gst', coalesce(p->>'gst', c.gst)));
  begin
    update public.customers set
      name = case when p ? 'name' then private.clean(p->>'name', 120) else name end,
      company = case when p ? 'company' then private.clean(p->>'company', 120) else company end,
      phone = case when p ? 'phone' then private.clean(p->>'phone', 20) else phone end,
      email = case when p ? 'email' then private.clean(p->>'email', 120) else email end,
      gst = case when p ? 'gst' then upper(private.clean(p->>'gst', 20)) else gst end,
      pincode = case when p ? 'pincode' then private.clean(p->>'pincode', 10) else pincode end,
      district = case when p ? 'district' then private.clean(p->>'district', 80) else district end,
      state = case when p ? 'state' then private.clean(p->>'state', 80) else state end,
      city = case when p ? 'city' then private.clean(p->>'city', 80) else city end,
      notes = case when p ? 'notes' then private.clean(p->>'notes', 2000) else notes end,
      updated_at = now()
    where id = p_id returning * into c;
  exception when unique_violation then
    raise exception 'Another customer already uses this phone number' using errcode = 'P0001', hint = 'conflict';
  end;
  update public.enquiries set
    customer_name = c.name, company = c.company, phone = c.phone, email = c.email, gst = c.gst,
    pincode = c.pincode, district = c.district, state = c.state, city = c.city,
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where customer_id = p_id;
  perform private.audit('customer.update', 'customer', c.cust_code, '{}'::jsonb);
end;
$$;

-- Known-customer autofill for the New Enquiry form (legacy getCustomerByPhone; any signed-in user).
create or replace function public.customer_by_phone(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.customers;
begin
  perform private.require_user();
  if length(public.phone_key(p_phone)) <> 10 then return jsonb_build_object('found', false); end if;
  select * into c from public.customers where phone_key = public.phone_key(p_phone) and active;
  if c.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'name', c.name, 'company', c.company, 'email', c.email,
    'gst', c.gst, 'pincode', c.pincode, 'district', c.district, 'state', c.state, 'city', c.city);
end;
$$;

-- Duplicate warning (legacy checkPhoneDuplicate): aggregate only, never PII.
create or replace function public.check_phone_duplicate(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when length(public.phone_key(p_phone)) <> 10 or count(*) = 0
              then jsonb_build_object('found', false)
              else jsonb_build_object('found', true, 'count', count(*),
                     'last_date', max(e.enq_date),
                     'last_stage', (array_agg(e.stage order by e.created_at desc))[1])
         end
    from public.enquiries e
   where e.phone_key = public.phone_key(p_phone) and e.active
$$;

-- -----------------------------------------------------------------------------
-- Team roster and user profiles (legacy Users / Team sheets)
-- -----------------------------------------------------------------------------
create or replace function public.admin_add_team_member(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_ uuid;
begin
  perform private.require_admin();
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name is required' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into public.team_members (name) values (private.clean(p_name, 80))
  on conflict (lower(btrim(name))) do update set active = true
  returning id into id_;
  perform private.audit('team.add', 'team_member', id_::text, jsonb_build_object('name', private.clean(p_name, 80)));
  return id_;
end;
$$;

create or replace function public.admin_set_team_member_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.team_members set active = p_active where id = p_id;
  if not found then raise exception 'Team member not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.audit('team.active', 'team_member', p_id::text, jsonb_build_object('active', p_active));
end;
$$;

-- service_role only: called by the server right after auth.admin.createUser().
-- Links (or creates) the team member with the same name, like legacy addUser().
create or replace function public.admin_create_profile(p_user_id uuid, p_username text, p_full_name text, p_role text, p_email text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m uuid;
begin
  if p_role not in ('admin','rep') then
    raise exception 'Invalid role' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into public.profiles (id, username, full_name, role, email)
  values (p_user_id, lower(btrim(p_username)), private.clean(p_full_name, 80), p_role, lower(btrim(coalesce(p_email, ''))));
  select id into m from public.team_members where lower(btrim(name)) = lower(btrim(p_full_name));
  if m is null then
    insert into public.team_members (name, profile_id) values (private.clean(p_full_name, 80), p_user_id);
  else
    update public.team_members set profile_id = p_user_id, active = true where id = m and profile_id is null;
    if not found then
      raise exception 'That name is already linked to another login' using errcode = 'P0001', hint = 'conflict';
    end if;
  end if;
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (p_actor, '', 'user.create', 'profile', p_user_id::text, jsonb_build_object('username', p_username, 'role', p_role));
end;
$$;

-- service_role only: role / active changes. The server also bans or unbans the auth user.
create or replace function public.admin_update_profile(p_user_id uuid, p_role text, p_active boolean, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  target public.profiles;
begin
  select * into actor from public.profiles where id = p_actor and active and role = 'admin';
  if actor.id is null then raise exception 'Admins only' using errcode = 'P0001', hint = 'forbidden'; end if;
  select * into target from public.profiles where id = p_user_id for update;
  if target.id is null then raise exception 'User not found' using errcode = 'P0001', hint = 'not_found'; end if;
  if p_user_id = p_actor and (p_role is distinct from 'admin' or p_active is false) then
    raise exception 'You cannot demote or deactivate yourself' using errcode = 'P0001', hint = 'invalid';
  end if;
  if p_role is not null and p_role not in ('admin','rep') then
    raise exception 'Invalid role' using errcode = 'P0001', hint = 'invalid';
  end if;
  update public.profiles set role = coalesce(p_role, role), active = coalesce(p_active, active), updated_at = now()
   where id = p_user_id;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'At least one active admin must remain' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (p_actor, actor.full_name, 'user.update', 'profile', p_user_id::text,
          jsonb_build_object('role', p_role, 'active', p_active));
end;
$$;

-- service_role only: audit entries for actions performed through the Auth admin API.
create or replace function public.audit_event(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (p_actor, coalesce((select full_name from public.profiles where id = p_actor), ''),
          left(p_action, 60), left(p_entity, 40), left(coalesce(p_entity_id, ''), 80), coalesce(p_details, '{}'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- Settings and holidays (admin)
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin()
              then (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from private.app_settings)
              else null end
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_admin();
begin
  if p_key = 'meta_import_target' and p_value #>> '{}' not in ('pending','enquiries') then
    raise exception 'meta_import_target must be pending or enquiries' using errcode = 'P0001', hint = 'invalid';
  elsif p_key in ('calls_soft_limit','archive_after_months')
        and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 1 or (p_value #>> '{}')::numeric > 120) then
    raise exception '% must be a number between 1 and 120', p_key using errcode = 'P0001', hint = 'invalid';
  elsif p_key = 'digest_recipients' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 20) then
    raise exception 'digest_recipients must be a list of up to 20 emails' using errcode = 'P0001', hint = 'invalid';
  elsif p_key not in ('meta_import_target','calls_soft_limit','archive_after_months','digest_recipients') then
    raise exception 'Unknown setting' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into private.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), me.id)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = me.id;
  perform private.audit('settings.set', 'setting', p_key, jsonb_build_object('value', p_value));
end;
$$;

create or replace function public.admin_set_holiday(p_day date, p_label text, p_present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_present then
    insert into public.holidays (day, label) values (p_day, private.clean(p_label, 80))
    on conflict (day) do update set label = excluded.label;
  else
    delete from public.holidays where day = p_day;
  end if;
  perform private.audit('holiday.set', 'holiday', p_day::text, jsonb_build_object('present', p_present));
end;
$$;

-- -----------------------------------------------------------------------------
-- Share links and the public metrics key: only SHA-256 hashes are stored.
-- -----------------------------------------------------------------------------
create or replace function public.admin_create_share_link(p_token_hash text, p_label text, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_admin();
  id_ uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '366 days' then
    raise exception 'Expiry must be within the next year' using errcode = 'P0001', hint = 'invalid';
  end if;
  insert into private.share_links (kind, token_hash, label, created_by, expires_at)
  values ('analysis', p_token_hash, private.clean(p_label, 120), me.id, p_expires_at) returning id into id_;
  perform private.audit('share_link.create', 'share_link', id_::text, jsonb_build_object('expires_at', p_expires_at));
  return id_;
end;
$$;

create or replace function public.admin_list_share_links()
returns table (id uuid, label text, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
               last_used_at timestamptz, use_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select s.id, s.label, s.created_at, s.expires_at, s.revoked_at, s.last_used_at, s.use_count
                 from private.share_links s order by s.created_at desc;
end;
$$;

create or replace function public.admin_revoke_share_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update private.share_links set revoked_at = now() where id = p_id and revoked_at is null;
  perform private.audit('share_link.revoke', 'share_link', p_id::text, '{}'::jsonb);
end;
$$;

-- service_role only.
create or replace function public.resolve_share_link(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_ uuid;
begin
  update private.share_links set last_used_at = now(), use_count = use_count + 1
   where token_hash = p_token_hash and revoked_at is null and expires_at > now()
  returning id into id_;
  return id_ is not null;
end;
$$;

create or replace function public.admin_set_metrics_key(p_key_hash text, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_admin();
begin
  update private.api_keys set revoked_at = now() where kind = 'public_metrics' and revoked_at is null;
  if p_key_hash is not null then
    insert into private.api_keys (kind, key_hash, label, created_by) values ('public_metrics', p_key_hash, private.clean(p_label, 120), me.id);
  end if;
  perform private.audit('metrics_key.rotate', 'api_key', '', jsonb_build_object('disabled', p_key_hash is null));
end;
$$;

create or replace function public.admin_metrics_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('active', count(*) > 0, 'created_at', max(created_at), 'last_used_at', max(last_used_at))
            from private.api_keys where kind = 'public_metrics' and revoked_at is null);
end;
$$;

-- service_role only.
create or replace function public.verify_metrics_key(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_ uuid;
begin
  update private.api_keys set last_used_at = now()
   where kind = 'public_metrics' and key_hash = p_key_hash and revoked_at is null
     and (expires_at is null or expires_at > now())
  returning id into id_;
  return id_ is not null;
end;
$$;

-- service_role only.
create or replace function public.rate_limit_hit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.hit_rate_limit(p_bucket, p_window_seconds, p_max) $$;

-- -----------------------------------------------------------------------------
-- External lead import (Meta Ads). Dedup is guaranteed by the external_lead_refs
-- primary key (legacy: a "MetaLeadID:" tag in Notes, which ignored Archive — BUG-007).
-- p_actor null = scheduled job (service_role); otherwise must be an active admin.
-- -----------------------------------------------------------------------------
create or replace function public.import_external_leads(p_source text, p_rows jsonb, p_kind text, p_file_name text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  target text;
  b public.import_batches;
  row_ jsonb;
  ext text;
  n_new integer := 0;
  n_dup integer := 0;
  n_bad integer := 0;
  errors jsonb := '[]'::jsonb;
  i integer := 0;
  pr public.pending_enquiries;
  e public.enquiries;
  inserted boolean;
  rc integer;
begin
  if auth.uid() is not null then
    actor := private.require_admin();
  elsif p_actor is not null then
    select * into actor from public.profiles where id = p_actor and active and role = 'admin';
    if actor.id is null then raise exception 'Admins only' using errcode = 'P0001', hint = 'forbidden'; end if;
  end if;
  if p_kind not in ('meta_file','meta_sheet') then
    raise exception 'Invalid import kind' using errcode = 'P0001', hint = 'invalid';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Rows must be a list of at most 5000 leads' using errcode = 'P0001', hint = 'invalid';
  end if;
  select value #>> '{}' into target from private.app_settings where key = 'meta_import_target';
  insert into public.import_batches (kind, file_name, created_by, total_rows)
  values (p_kind, private.clean(p_file_name, 200), actor.id, jsonb_array_length(p_rows)) returning * into b;

  for row_ in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    ext := private.clean(row_->>'external_id', 200);
    if ext = '' or (length(btrim(coalesce(row_->>'name', ''))) = 0 and length(public.phone_key(row_->>'phone')) = 0) then
      n_bad := n_bad + 1;
      errors := errors || jsonb_build_object('row', i, 'error', 'missing lead id or contact');
      continue;
    end if;
    insert into public.external_lead_refs (source, external_id, batch_id, raw)
    values (p_source, ext, b.id, coalesce(row_->'raw', '{}'::jsonb))
    on conflict (source, external_id) do nothing;
    get diagnostics rc = row_count;
    inserted := rc > 0;
    if not inserted then
      n_dup := n_dup + 1;
      continue;
    end if;
    if coalesce(target, 'pending') = 'enquiries' then
      e := private.insert_enquiry(jsonb_build_object(
             'customer_name', coalesce(nullif(btrim(row_->>'name'), ''), '(no name)'), 'company', row_->>'company',
             'phone', row_->>'phone', 'city', row_->>'city', 'pincode', row_->>'pincode',
             'district', row_->>'district', 'state', row_->>'state', 'source', 'Meta Ads',
             'requirement', row_->>'requirement', 'qty', row_->>'qty',
             'notes', 'Auto-imported from Meta Ads · lead ' || ext), null, true, actor.id);
      update public.external_lead_refs set enquiry_id = e.id where source = p_source and external_id = ext;
    else
      pr := private.insert_pending(jsonb_build_object(
             'customer_name', coalesce(nullif(btrim(row_->>'name'), ''), '(no name)'), 'company', row_->>'company',
             'phone', row_->>'phone', 'city', row_->>'city', 'pincode', row_->>'pincode',
             'district', row_->>'district', 'state', row_->>'state', 'source', 'Meta Ads',
             'requirement', row_->>'requirement', 'qty', row_->>'qty',
             'notes', 'Auto-imported from Meta Ads · lead ' || ext),
             'meta_import', actor.id, 'Meta Ads import', b.id, null);
      update public.external_lead_refs set pending_id = pr.id where source = p_source and external_id = ext;
    end if;
    n_new := n_new + 1;
  end loop;

  update public.import_batches set accepted = n_new, duplicates = n_dup, rejected = n_bad,
         report = jsonb_build_object('errors', errors, 'target', coalesce(target, 'pending'))
   where id = b.id;
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (actor.id, coalesce(actor.full_name, 'scheduled job'), 'import.meta', 'import_batch', b.id::text,
          jsonb_build_object('new', n_new, 'duplicates', n_dup, 'rejected', n_bad));
  return jsonb_build_object('batch_id', b.id, 'imported', n_new, 'duplicates', n_dup, 'rejected', n_bad,
                            'target', coalesce(target, 'pending'), 'errors', errors);
end;
$$;

-- -----------------------------------------------------------------------------
-- OMS bridge (legacy OmsBridge.js recordOrderToOms). Two-phase so a retry never
-- creates a second OMS order: begin (user, authorizes + reserves) → server calls
-- OMS → complete (service_role only, records result and marks Won).
-- -----------------------------------------------------------------------------
create or replace function public.oms_begin_order(p_enquiry_id uuid, p_request_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_user();
  e public.enquiries;
  r public.oms_order_requests;
begin
  select * into e from public.enquiries where id = p_enquiry_id and active and archived_at is null for update;
  if e.id is null then raise exception 'Enquiry not found' using errcode = 'P0001', hint = 'not_found'; end if;
  perform private.require_owner_or_admin(e.owner_id);
  if e.oms_order_id is not null then
    raise exception 'Order already recorded: %', e.oms_order_id using errcode = 'P0001', hint = 'conflict';
  end if;
  select * into r from public.oms_order_requests where request_key = p_request_key;
  if r.id is not null then
    return jsonb_build_object('request_id', r.id, 'status', r.status, 'oms_order_id', r.oms_order_id);
  end if;
  -- A request that failed earlier frees the slot; a started one blocks a parallel submit.
  if exists (select 1 from public.oms_order_requests where enquiry_id = e.id and status = 'started'
               and created_at > now() - interval '2 minutes') then
    raise exception 'An order for this enquiry is already being recorded' using errcode = 'P0001', hint = 'conflict';
  end if;
  update public.oms_order_requests set status = 'failed', error = 'abandoned', finished_at = now()
   where enquiry_id = e.id and status = 'started';
  insert into public.oms_order_requests (enquiry_id, request_key, created_by)
  values (e.id, p_request_key, me.id) returning * into r;
  return jsonb_build_object('request_id', r.id, 'status', r.status,
    'enquiry', jsonb_build_object('code', e.enq_code, 'customer_name', e.customer_name, 'company', e.company,
      'phone', e.phone, 'email', e.email, 'gst', e.gst, 'quote_no', e.quote_no, 'stage', e.stage));
end;
$$;

-- service_role only.
create or replace function public.oms_complete_order(p_request_key uuid, p_ok boolean, p_oms_order_id text, p_error text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.oms_order_requests;
  e public.enquiries;
begin
  select * into r from public.oms_order_requests where request_key = p_request_key for update;
  if r.id is null then raise exception 'Unknown request' using errcode = 'P0001', hint = 'not_found'; end if;
  if r.status = 'succeeded' then return; end if;
  if not p_ok then
    update public.oms_order_requests set status = 'failed', error = left(coalesce(p_error, ''), 500), finished_at = now() where id = r.id;
    return;
  end if;
  update public.oms_order_requests
     set status = 'succeeded', oms_order_id = p_oms_order_id, payload = coalesce(p_payload, '{}'::jsonb), finished_at = now()
   where id = r.id;
  update public.enquiries set oms_order_id = p_oms_order_id, version = version + 1, updated_at = now()
   where id = r.enquiry_id returning * into e;
  -- Order recorded == deal won (legacy: moveStage Won with skipInvoice).
  if e.stage in ('New','Quoted','Follow-up') then
    perform private.do_move_stage(e.id, 'Won', jsonb_build_object('note', 'Order recorded in OMS: ' || p_oms_order_id), null, true);
  end if;
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (r.created_by, '', 'oms.order', 'enquiry', e.enq_code, jsonb_build_object('oms_order_id', p_oms_order_id));
end;
$$;

-- service_role only: idempotent job bookkeeping (daily digest etc).
create or replace function public.job_try_start(p_job text, p_run_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  id_ uuid;
begin
  insert into private.job_runs (job, run_key) values (p_job, p_run_key)
  on conflict (job, run_key) do update set status = 'running', started_at = now()
    where private.job_runs.status = 'failed'
  returning id into id_;
  return id_ is not null;
end;
$$;

create or replace function public.job_finish(p_job text, p_run_key text, p_status text, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.job_runs set status = p_status, finished_at = now(), details = coalesce(p_details, '{}'::jsonb)
   where job = p_job and run_key = p_run_key
$$;

create or replace function public.admin_recent_jobs()
returns table (job text, run_key text, status text, started_at timestamptz, finished_at timestamptz, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select j.job, j.run_key, j.status, j.started_at, j.finished_at, j.details
                 from private.job_runs j order by j.started_at desc limit 50;
end;
$$;

create or replace function public.admin_audit_log(p_limit integer default 100, p_entity text default null)
returns table (at timestamptz, actor_label text, action text, entity text, entity_id text, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select a.at, a.actor_label, a.action, a.entity, a.entity_id, a.details
                 from private.audit_log a
                where p_entity is null or a.entity = p_entity
                order by a.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
