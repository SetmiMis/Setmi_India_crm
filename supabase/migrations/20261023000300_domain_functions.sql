-- =============================================================================
-- SETMI INDIA CRM — business rules and authorization helpers
-- Every rule below is ported from the legacy source; the source line is cited so
-- behaviour can be re-verified. Rules are covered by supabase/tests/*.test.ts.
-- =============================================================================

-- Business "today" (legacy TZ = Asia/Kolkata).
create or replace function private.today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Working day = not Sunday and not a company holiday (Code.js isWorkingDay_).
create or replace function private.is_working_day(d date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from d) <> 7
     and not exists (select 1 from public.holidays h where h.day = d)
$$;

-- Code.js addWorkingDays_: step forward one calendar day at a time, counting only working days.
create or replace function private.add_working_days(from_date date, n integer)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  d date := coalesce(from_date, private.today());
  left_ integer := greatest(coalesce(n, 0), 0);
begin
  while left_ > 0 loop
    d := d + 1;
    if private.is_working_day(d) then
      left_ := left_ - 1;
    end if;
  end loop;
  return d;
end;
$$;

-- Code.js FOLLOWUP_INTERVAL_DAYS = { Hot: 1, Warm: 2, Cold: 6 }; unknown priority falls back to Warm.
create or replace function private.follow_up_interval(priority text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case priority when 'Hot' then 1 when 'Cold' then 6 else 2 end
$$;

create or replace function private.compute_next_follow_up(priority text, actual date)
returns date
language sql
stable
set search_path = ''
as $$ select private.add_working_days(actual, private.follow_up_interval(priority)) $$;

-- Code.js gradeFor_(qty, timeline). Qty rows: <20, 20–500, >500 (metres/units).
-- NOTE: the FMS PDF draws the middle band as 20–200m; the code (authoritative) uses 500.
create or replace function private.grade_for(qty numeric, timeline text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  r integer;
  c integer;
begin
  if qty is null or qty = 0 or timeline is null
     or timeline not in ('Immediate','Fortnight','Just Exploring') then
    return null;
  end if;
  r := case when qty > 500 then 2 when qty >= 20 then 1 else 0 end;
  c := case timeline when 'Just Exploring' then 0 when 'Fortnight' then 1 else 2 end;
  if r = 2 then return case when c >= 1 then 'A' else 'B' end; end if;
  if r = 1 then return case c when 2 then 'A' when 1 then 'B' else 'C' end; end if;
  return case when c = 2 then 'B' else 'C' end;
end;
$$;

-- Code.js calculateFollowupStatus.
create or replace function private.follow_up_status(next_fu date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when next_fu is null then 'No Follow-up'
           when next_fu < private.today() then 'Overdue'
           when next_fu = private.today() then 'Today'
           when next_fu = private.today() + 1 then 'Tomorrow'
           else 'Upcoming'
         end
$$;

-- Allowed pipeline transitions. Legacy moveStage accepted any transition (BUG-009);
-- this table encodes the flow drawn in docs/05 plus admin-only re-open of Lost.
create or replace function private.stage_transition_allowed(from_stage text, to_stage text, is_admin boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_stage
    when 'New'        then to_stage in ('Quoted','Follow-up','Won','Lost')
    when 'Quoted'     then to_stage in ('Follow-up','Won','Lost')
    when 'Follow-up'  then to_stage in ('Quoted','Won','Lost')
    when 'Won'        then to_stage in ('Dispatched','Closed')
    when 'Dispatched' then to_stage in ('Closed')
    when 'Lost'       then is_admin and to_stage in ('Follow-up')
    else false
  end
$$;

-- -----------------------------------------------------------------------------
-- Authorization helpers. auth.uid() is the Supabase JWT subject.
-- -----------------------------------------------------------------------------
create or replace function private.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active) $$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'admin') $$;

create or replace function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.team_members t
    join public.profiles p on p.id = t.profile_id
   where p.id = auth.uid() and p.active
$$;

-- Raise unless the caller is an active signed-in user; returns the profile.
create or replace function private.require_user()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid() and active;
  if p.id is null then
    raise exception 'Not signed in or account inactive' using errcode = 'P0001', hint = 'unauthenticated';
  end if;
  return p;
end;
$$;

create or replace function private.require_admin()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles := private.require_user();
begin
  if p.role <> 'admin' then
    raise exception 'Admins only' using errcode = 'P0001', hint = 'forbidden';
  end if;
  return p;
end;
$$;

-- Code.js requireOwnLeadOrAdmin_: reps may only act on leads they own.
create or replace function private.require_owner_or_admin(p_owner uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_admin() then return; end if;
  if p_owner is null or p_owner is distinct from private.current_member_id() then
    raise exception 'You can only do this on your own leads' using errcode = 'P0001', hint = 'forbidden';
  end if;
end;
$$;

create or replace function private.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
begin
  select coalesce(full_name, '') into label from public.profiles where id = auth.uid();
  insert into private.audit_log (actor_id, actor_label, action, entity, entity_id, details)
  values (auth.uid(), coalesce(label, case when auth.uid() is null then 'system' else '' end),
          p_action, p_entity, coalesce(p_entity_id, ''), coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Fixed-window rate limiter (used by the server for public endpoints and logins).
create or replace function private.hit_rate_limit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into private.rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
  on conflict (bucket, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into n;
  -- opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_max;
end;
$$;

-- Normalizers shared by intake paths.
create or replace function private.clean(t text, max_len integer default 500)
returns text
language sql
immutable
set search_path = ''
as $$ select left(btrim(regexp_replace(coalesce(t, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), max_len) $$;

create or replace function private.valid_source(s text)
returns text
language sql
stable
set search_path = ''
as $$ select coalesce((select name from public.lead_sources where name = btrim(s) and active), 'Other') $$;

create or replace function private.num_or_null(t text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g');
begin
  if cleaned = '' or cleaned = '-' or cleaned = '.' then return null; end if;
  return cleaned::numeric;
exception when others then
  return null;
end;
$$;

-- Upsert a customer by phone key. mode 'fill' only fills blanks (legacy upsertCustomer_),
-- mode 'overwrite' replaces provided fields (legacy upsertCustomerOverwrite_).
create or replace function private.upsert_customer(p jsonb, mode text default 'fill')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text := public.phone_key(p->>'phone');
  c public.customers;
begin
  if k <> '' then
    select * into c from public.customers where phone_key = k and active for update;
  end if;
  if c.id is null then
    insert into public.customers (name, company, phone, email, gst, pincode, district, state, city, source, notes)
    values (private.clean(p->>'name', 120), private.clean(p->>'company', 120), private.clean(p->>'phone', 20),
            private.clean(p->>'email', 120), private.clean(p->>'gst', 20), private.clean(p->>'pincode', 10),
            private.clean(p->>'district', 80), private.clean(p->>'state', 80), private.clean(p->>'city', 80),
            private.clean(p->>'source', 40), private.clean(p->>'notes', 2000))
    returning * into c;
    return c.id;
  end if;
  if mode = 'overwrite' then
    update public.customers set
      name     = case when p ? 'name'     then private.clean(p->>'name', 120)     else name end,
      company  = case when p ? 'company'  then private.clean(p->>'company', 120)  else company end,
      phone    = case when p ? 'phone' and private.clean(p->>'phone', 20) <> '' then private.clean(p->>'phone', 20) else phone end,
      email    = case when p ? 'email'    then private.clean(p->>'email', 120)    else email end,
      gst      = case when p ? 'gst'      then private.clean(p->>'gst', 20)       else gst end,
      pincode  = case when p ? 'pincode'  then private.clean(p->>'pincode', 10)   else pincode end,
      district = case when p ? 'district' then private.clean(p->>'district', 80)  else district end,
      state    = case when p ? 'state'    then private.clean(p->>'state', 80)     else state end,
      city     = case when p ? 'city'     then private.clean(p->>'city', 80)      else city end,
      updated_at = now()
    where id = c.id;
  else
    update public.customers set
      name     = case when name = ''     then private.clean(p->>'name', 120)    else name end,
      company  = case when company = ''  then private.clean(p->>'company', 120) else company end,
      email    = case when email = ''    then private.clean(p->>'email', 120)   else email end,
      gst      = case when gst = ''      then private.clean(p->>'gst', 20)      else gst end,
      pincode  = case when pincode = ''  then private.clean(p->>'pincode', 10)  else pincode end,
      district = case when district = '' then private.clean(p->>'district', 80) else district end,
      state    = case when state = ''    then private.clean(p->>'state', 80)    else state end,
      city     = case when city = ''     then private.clean(p->>'city', 80)     else city end,
      updated_at = now()
    where id = c.id;
  end if;
  return c.id;
end;
$$;
