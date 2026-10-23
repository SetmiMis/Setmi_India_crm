-- =============================================================================
-- SETMI INDIA CRM — read RPCs (server-side aggregation; replaces full-sheet scans)
-- Scoping rule (legacy getPipeline/scopeDashFilter_): reps only ever see their own
-- leads, whatever filter the client sends; admins see everyone.
-- =============================================================================

-- Admin: the requested owner (null = all). Rep: always themselves.
create or replace function private.scope_owner(p_requested uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_admin() then return p_requested; end if;
  return coalesce(private.current_member_id(), '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

-- Live (not deleted, not archived) enquiries visible to the caller with dashboard filters applied.
create or replace function private.filtered_enquiries(f jsonb)
returns setof public.enquiries
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_ boolean := private.is_admin();
  want_unassigned boolean := admin_ and coalesce(f->>'owner_id', '') = 'unassigned';
  scoped uuid;
begin
  if want_unassigned then
    scoped := null;
  else
    scoped := private.scope_owner(case when coalesce(f->>'owner_id', '') ~ '^[0-9a-fA-F-]{36}$' then (f->>'owner_id')::uuid end);
  end if;
  return query
    select e.* from public.enquiries e
     where e.active and e.archived_at is null
       and (scoped is null or e.owner_id = scoped)
       and (not want_unassigned or e.owner_id is null)
       and (coalesce(f->>'date_from', '') = '' or e.enq_date >= (f->>'date_from')::date)
       and (coalesce(f->>'date_to', '') = '' or e.enq_date <= (f->>'date_to')::date)
       and (coalesce(f->>'source', '') = '' or e.source = f->>'source')
       and (coalesce(f->>'priority', '') = '' or e.priority = f->>'priority')
       and (coalesce(f->>'stage', '') = '' or e.stage = f->>'stage');
end;
$$;

-- Dashboard KPIs + charts in one round trip (legacy getDashboardData).
create or replace function public.dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  today_ date := private.today();
  month_start date := date_trunc('month', private.today())::date;
  k jsonb;
  charts jsonb;
begin
  perform private.require_user();
  with l as (
    select * from private.filtered_enquiries(f)
  ), agg as (
    select
      count(*) as total,
      count(*) filter (where stage in ('New','Quoted','Follow-up')) as open_,
      coalesce(sum(coalesce(nullif(quote_amount, 0), est_value, 0)) filter (where stage in ('New','Quoted','Follow-up')), 0) as pipeline_value,
      count(*) filter (where stage = 'Won' and coalesce(last_contact, created_at::date) >= month_start) as won_month,
      coalesce(sum(coalesce(order_value, 0)) filter (where stage in ('Won','Dispatched') and coalesce(last_contact, created_at::date) >= month_start), 0) as won_revenue,
      count(*) filter (where stage in ('Won','Dispatched','Closed')) as won_total,
      count(*) filter (where stage = 'Lost') as lost_total,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and priority = 'Hot') as hot,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and priority = 'Warm') as warm,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and (priority = 'Cold' or priority is null)) as cold,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and next_follow_up < today_) as overdue,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and next_follow_up = today_) as due_today,
      count(*) filter (where stage <> 'New' or last_contact is not null) as contacted,
      count(*) filter (where (stage <> 'New' or last_contact is not null) and stage in ('Quoted','Follow-up','Won','Dispatched','Closed')) as approved,
      count(*) filter (where (stage <> 'New' or last_contact is not null) and stage in ('Won','Dispatched','Closed')) as converted,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and escalation = 'Proprietor') as esc_prop,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and escalation = 'Shop Floor') as esc_shop,
      count(*) filter (where stage in ('New','Quoted','Follow-up') and grade = 'A') as grade_a
    from l
  )
  select jsonb_build_object(
    'total_enquiries', total, 'active_pipeline', open_, 'pipeline_value', pipeline_value,
    'won_revenue', won_revenue, 'won_month_count', won_month,
    'hot', hot, 'warm', warm, 'cold', cold, 'overdue', overdue, 'due_today', due_today,
    'win_rate', case when won_total + lost_total > 0 then round(won_total * 100.0 / (won_total + lost_total)) else 0 end,
    'contacted', contacted, 'contacted_pct', case when total > 0 then round(contacted * 100.0 / total, 2) else 0 end,
    'approved', approved, 'approved_pct', case when contacted > 0 then round(approved * 100.0 / contacted, 2) else 0 end,
    'converted', converted, 'converted_pct', case when approved > 0 then round(converted * 100.0 / approved, 2) else 0 end,
    'esc_proprietor', esc_prop, 'esc_shop_floor', esc_shop, 'grade_a_open', grade_a,
    'funnel', (select coalesce(jsonb_object_agg(s, (select count(*) from l where l.stage = s)), '{}'::jsonb)
                 from unnest(array['New','Quoted','Follow-up','Won','Lost','Dispatched','Closed']) s),
    'as_of', now())
  into k from agg;

  with l as (select * from private.filtered_enquiries(f))
  select jsonb_build_object(
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m), '[]'::jsonb)
                 from (select to_char(enq_date, 'YYYY-MM') m, count(*) c from l group by 1 order by 1 desc limit 6) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('label', source, 'count', c) order by c desc), '[]'::jsonb)
                  from (select source, count(*) c from l group by 1) x),
    'priorities', (select jsonb_build_object(
                     'Hot', count(*) filter (where priority = 'Hot'),
                     'Warm', count(*) filter (where priority = 'Warm' or priority is null),
                     'Cold', count(*) filter (where priority = 'Cold')) from l),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(t.name, 'Unassigned'), 'count', c) order by c desc), '[]'::jsonb)
                 from (select owner_id, count(*) c from l group by 1) x left join public.team_members t on t.id = x.owner_id),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c, 'value', v) order by c desc), '[]'::jsonb)
                 from (select btrim(state) state, count(*) c, sum(coalesce(nullif(quote_amount, 0), est_value, 0)) v
                         from l where btrim(state) <> '' group by 1) x)
  ) into charts;

  return jsonb_build_object('kpis', k, 'charts', charts);
end;
$$;

-- Available Leads (legacy getUnclaimedEnquiries): limited fields only.
create or replace function public.available_leads(p_limit integer default 100, p_offset integer default 0, p_q text default null)
returns table (id uuid, enq_code text, customer_name text, company text, phone text, city text, requirement text,
               source text, enq_date date, created_at timestamptz, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return query
    select e.id, e.enq_code, e.customer_name, e.company, e.phone, e.city, e.requirement, e.source, e.enq_date,
           e.created_at, count(*) over ()
      from public.enquiries e
     where e.owner_id is null and e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up')
       and (coalesce(p_q, '') = '' or (e.customer_name || ' ' || e.company || ' ' || e.phone || ' ' || e.city || ' ' || e.requirement) ilike '%' || p_q || '%')
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Follow-ups due (legacy getFollowUpsDue): overdue, today, upcoming (capped at 15).
create or replace function public.follow_ups_due()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scoped uuid;
  today_ date := private.today();
begin
  perform private.require_user();
  scoped := private.scope_owner(null);
  return (
    with l as (
      select e.id, e.enq_code, e.customer_name, e.company, e.phone, e.stage, e.priority, e.grade, e.next_follow_up,
             e.last_contact, e.requirement, t.name as owner_name,
             greatest(today_ - e.next_follow_up, 0) as days_overdue
        from public.enquiries e left join public.team_members t on t.id = e.owner_id
       where e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up')
         and e.next_follow_up is not null and (scoped is null or e.owner_id = scoped)
    )
    select jsonb_build_object(
      'overdue', (select coalesce(jsonb_agg(to_jsonb(l) order by next_follow_up, enq_code), '[]'::jsonb) from l where next_follow_up < today_),
      'today', (select coalesce(jsonb_agg(to_jsonb(l) order by enq_code), '[]'::jsonb) from l where next_follow_up = today_),
      'upcoming', (select coalesce(jsonb_agg(to_jsonb(x) order by next_follow_up, enq_code), '[]'::jsonb)
                     from (select * from l where next_follow_up > today_ order by next_follow_up, enq_code limit 15) x))
  );
end;
$$;

create or replace function public.follow_up_badge_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scoped uuid;
  today_ date := private.today();
  pending_n bigint := 0;
  transfers_n bigint := 0;
begin
  perform private.require_user();
  scoped := private.scope_owner(null);
  if private.is_admin() then
    select count(*) into pending_n from public.pending_enquiries where status = 'Pending';
  end if;
  select count(*) into transfers_n from public.enquiry_transfers
   where status = 'Proposed' and to_member_id = private.current_member_id();
  return (select jsonb_build_object(
            'overdue', count(*) filter (where next_follow_up < today_),
            'due_today', count(*) filter (where next_follow_up = today_),
            'pending_approvals', pending_n,
            'incoming_transfers', transfers_n)
            from public.enquiries
           where active and archived_at is null and stage in ('New','Quoted','Follow-up')
             and (scoped is null or owner_id = scoped));
end;
$$;

-- Call centre KPIs for today (legacy getCallDashboard).
create or replace function public.call_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scoped uuid;
  today_ date := private.today();
  r jsonb;
begin
  perform private.require_user();
  scoped := private.scope_owner(null);
  select jsonb_build_object(
    'todays_calls', count(*),
    'completed_calls', count(*) filter (where call_status = 'Connected'),
    'missed_calls', count(*) filter (where call_status <> 'Connected'))
  into r
  from public.call_logs c
  where c.call_date = today_ and (scoped is null or c.employee_member_id = scoped);
  return r || jsonb_build_object('pending_calls', (
    select count(*) from public.enquiries e
     where e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up')
       and e.next_follow_up <= today_ and (scoped is null or e.owner_id = scoped)
       and not exists (select 1 from public.call_logs c where c.enquiry_id = e.id and c.call_date = today_)));
end;
$$;

-- Admin reports (legacy getReports).
create or replace function public.reports_summary(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (
    with l as (
      select e.* from public.enquiries e
       where e.active and e.archived_at is null
         and (p_date_from is null or e.enq_date >= p_date_from) and (p_date_to is null or e.enq_date <= p_date_to)
    )
    select jsonb_build_object(
      'sources', (select coalesce(jsonb_agg(x order by (x->>'enquiries')::int desc), '[]'::jsonb) from (
          select jsonb_build_object('source', source, 'enquiries', count(*),
                   'won', count(*) filter (where stage in ('Won','Dispatched','Closed')),
                   'lost', count(*) filter (where stage = 'Lost'),
                   'win_rate', case when count(*) filter (where stage in ('Won','Dispatched','Closed','Lost')) > 0
                                    then round(count(*) filter (where stage in ('Won','Dispatched','Closed')) * 100.0
                                               / count(*) filter (where stage in ('Won','Dispatched','Closed','Lost'))) else 0 end) x
            from l group by source) s),
      'owners', (select coalesce(jsonb_agg(x order by (x->>'enquiries')::int desc), '[]'::jsonb) from (
          select jsonb_build_object('owner', coalesce(t.name, '—'), 'enquiries', count(*),
                   'won', count(*) filter (where l.stage in ('Won','Dispatched','Closed')),
                   'lost', count(*) filter (where l.stage = 'Lost')) x
            from l left join public.team_members t on t.id = l.owner_id group by t.name) s),
      'stages', (select coalesce(jsonb_object_agg(stage, c), '{}'::jsonb) from (select stage, count(*) c from l group by stage) s),
      'lost_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', r, 'count', c) order by c desc), '[]'::jsonb)
                         from (select coalesce(nullif(btrim(lost_reason), ''), '(not recorded)') r, count(*) c
                                 from l where stage = 'Lost' group by 1 order by 2 desc limit 15) s)
    ));
end;
$$;

-- Admin leaderboard (legacy getTeamPerformance).
create or replace function public.team_performance()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today_ date := private.today();
  month_start date := date_trunc('month', private.today())::date;
begin
  perform private.require_admin();
  return (
    with reps as (
      select t.id, t.name, t.active from public.team_members t
       where t.active
          or exists (select 1 from public.enquiries e where e.owner_id = t.id and e.active and e.archived_at is null)
          or exists (select 1 from public.call_logs c where c.employee_member_id = t.id and c.call_date >= month_start)
    ), stats as (
      select r.name, r.active,
        (select count(*) from public.enquiries e where e.owner_id = r.id and e.active and e.archived_at is null) leads,
        (select count(*) from public.enquiries e where e.owner_id = r.id and e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up')) open_,
        (select count(*) from public.enquiries e where e.owner_id = r.id and e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up') and e.next_follow_up < today_) overdue,
        (select count(*) from public.call_logs c where c.employee_member_id = r.id and c.call_date >= month_start) calls_month,
        (select count(*) from public.call_logs c where c.employee_member_id = r.id and c.call_date = today_) calls_today,
        (select count(*) from public.follow_ups f where f.by_member_id = r.id and f.created_at >= month_start) followups_month,
        (select count(*) from public.enquiries e where e.owner_id = r.id and e.active and e.archived_at is null and e.stage in ('Won','Dispatched','Closed')) won,
        (select count(*) from public.enquiries e where e.owner_id = r.id and e.active and e.archived_at is null and e.stage = 'Lost') lost
      from reps r
    )
    select jsonb_build_object(
      'reps', coalesce(jsonb_agg(jsonb_build_object('name', name, 'active', active, 'leads', leads, 'open', open_,
                'overdue', overdue, 'calls_month', calls_month, 'calls_today', calls_today,
                'followups_month', followups_month, 'won', won, 'lost', lost,
                'win_rate', case when won + lost > 0 then round(won * 100.0 / (won + lost)) else 0 end)
              order by won desc, leads desc, calls_month desc), '[]'::jsonb),
      'as_of', now())
    from stats);
end;
$$;

-- Customers list with enquiry counts (legacy getCustomers). Reps: customers of their own leads.
create or replace function public.list_customers(p_q text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, cust_code text, name text, company text, phone text, email text, gst text, pincode text,
               district text, state text, city text, source text, notes text, enquiries bigint, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_ boolean;
  me uuid;
begin
  perform private.require_user();
  admin_ := private.is_admin();
  me := private.current_member_id();
  return query
    select c.id, c.cust_code, c.name, c.company, c.phone, c.email, c.gst, c.pincode, c.district, c.state, c.city,
           c.source, c.notes,
           (select count(*) from public.enquiries e where e.customer_id = c.id and e.active),
           count(*) over ()
      from public.customers c
     where c.active
       and (admin_ or exists (select 1 from public.enquiries e where e.customer_id = c.id and e.owner_id = me and e.active))
       and (coalesce(p_q, '') = '' or (c.name || ' ' || c.company || ' ' || c.phone || ' ' || c.city) ilike '%' || p_q || '%')
     order by c.name, c.cust_code
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Data Analysis rows (legacy analysisBuild_): PII-free; requirement head is mapped to a
-- product label on the server before it reaches any browser.
create or replace function private.analysis_rows_internal(p_owner uuid, p_all boolean)
returns table (month text, enq_date date, requirement_head text, qty_text text, state text, stage text, source text,
               owner_name text, pincode text, district text, called boolean, connected boolean, interested boolean,
               est_value numeric, resp_days integer, idle_days integer, repeat_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with calls as (
    select enquiry_id, bool_or(true) called, bool_or(call_status = 'Connected') connected,
           bool_or(interest = 'Interested') interested, min(call_date) first_call, max(call_date) last_call
      from public.call_logs group by enquiry_id
  ), phones as (
    select phone_key, count(*)::int n from public.enquiries where active and archived_at is null and length(phone_key) = 10 group by phone_key
  )
  select to_char(e.enq_date, 'YYYY-MM'), e.enq_date,
         split_part(e.requirement, ' — ', 1), replace(split_part(e.requirement, ' — ', 2), 'Qty: ', ''),
         e.state, e.stage, e.source, coalesce(t.name, '—'), left(regexp_replace(e.pincode, '\D', '', 'g'), 6), e.district,
         coalesce(c.called, false), coalesce(c.connected, false), coalesce(c.interested, false),
         coalesce(e.est_value, 0),
         case when c.first_call is not null then greatest(c.first_call - e.enq_date, 0) end,
         greatest(private.today() - greatest(coalesce(e.last_contact, e.enq_date), coalesce(c.last_call, e.enq_date), e.enq_date), 0),
         coalesce(p.n, 1)
    from public.enquiries e
    left join calls c on c.enquiry_id = e.id
    left join phones p on p.phone_key = e.phone_key
    left join public.team_members t on t.id = e.owner_id
   where e.active and e.archived_at is null and (p_all or e.owner_id = p_owner)
   order by e.enq_date desc
   limit 20000
$$;

create or replace function public.analysis_rows()
returns table (month text, enq_date date, requirement_head text, qty_text text, state text, stage text, source text,
               owner_name text, pincode text, district text, called boolean, connected boolean, interested boolean,
               est_value numeric, resp_days integer, idle_days integer, repeat_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return query select * from private.analysis_rows_internal(private.current_member_id(), private.is_admin());
end;
$$;

-- service_role only: share-link variant (legacy getAnalysisShared blanks owner/speed/idle/repeat).
create or replace function public.analysis_rows_shared()
returns table (month text, enq_date date, requirement_head text, qty_text text, state text, stage text, source text,
               pincode text, district text, called boolean, connected boolean, interested boolean, est_value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select month, enq_date, requirement_head, qty_text, state, stage, source, pincode, district, called, connected,
         interested, est_value
    from private.analysis_rows_internal(null, true)
$$;

-- Customers List (legacy getCustomersList): Won/Dispatched/Closed, one row per phone. Login required.
create or replace function public.won_customers_list()
returns table (customer_name text, company text, phone text, requirement_head text, state text, city text,
               enq_date date, stage text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_ boolean;
  me uuid;
begin
  perform private.require_user();
  admin_ := private.is_admin();
  me := private.current_member_id();
  return query
    select distinct on (e.phone_key) e.customer_name, e.company, e.phone_key, split_part(e.requirement, ' — ', 1),
           e.state, coalesce(nullif(e.city, ''), e.district), e.enq_date, e.stage
      from public.enquiries e
     where e.active and e.archived_at is null and e.stage in ('Won','Dispatched','Closed') and length(e.phone_key) = 10
       and (admin_ or e.owner_id = me)
     order by e.phone_key, e.enq_date desc;
end;
$$;

-- Map analytics: aggregated by place; coordinates from pincode centroids.
create or replace function private.map_aggregate_internal(p_owner uuid, p_all boolean, f jsonb)
returns table (state text, district text, pincode text, lat numeric, lng numeric, source text, total bigint,
               open_ bigint, won bigint, lost bigint, value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select btrim(e.state), btrim(e.district), g.pincode, g.lat, g.lng, e.source,
         count(*),
         count(*) filter (where e.stage in ('New','Quoted','Follow-up')),
         count(*) filter (where e.stage in ('Won','Dispatched','Closed')),
         count(*) filter (where e.stage = 'Lost'),
         sum(coalesce(nullif(e.quote_amount, 0), e.est_value, 0))
    from public.enquiries e
    left join public.pincode_geo g on g.pincode = left(regexp_replace(e.pincode, '\D', '', 'g'), 6)
   where e.active and e.archived_at is null and (p_all or e.owner_id = p_owner)
     and (coalesce(f->>'date_from', '') = '' or e.enq_date >= (f->>'date_from')::date)
     and (coalesce(f->>'date_to', '') = '' or e.enq_date <= (f->>'date_to')::date)
     and (coalesce(f->>'source', '') = '' or e.source = f->>'source')
     and (coalesce(f->>'stage', '') = '' or e.stage = f->>'stage')
   group by 1, 2, 3, 4, 5, 6
$$;

create or replace function public.map_aggregate(p_filters jsonb default '{}'::jsonb)
returns table (state text, district text, pincode text, lat numeric, lng numeric, source text, total bigint,
               open_ bigint, won bigint, lost bigint, value numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  return query select * from private.map_aggregate_internal(private.current_member_id(), private.is_admin(), coalesce(p_filters, '{}'::jsonb));
end;
$$;

-- service_role only: counts-only public metrics feed (legacy publicMetricsJson_).
create or replace function public.public_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select * from public.enquiries where active and archived_at is null),
  m as (select date_trunc('month', private.today())::date ms)
  select jsonb_build_object(
    'as_of', now(),
    'customers', (select count(*) from public.customers where active),
    'enquiries_total', (select count(*) from l),
    'enquiries_this_month', (select count(*) from l, m where l.enq_date >= m.ms),
    'calls_this_month', (select count(*) from public.call_logs c, m where c.call_date >= m.ms),
    'follow_ups_this_month', (select count(*) from public.follow_ups f, m where f.created_at >= m.ms),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', mo, 'count', c) order by mo), '[]'::jsonb)
                 from (select to_char(enq_date, 'YYYY-MM') mo, count(*) c from l group by 1 order by 1 desc limit 6) x),
    'demand', (select coalesce(jsonb_agg(jsonb_build_object('name', b, 'count', c) order by c desc), '[]'::jsonb) from (
                 select b, count(*) c from (
                   select case
                     when requirement ~* 'switch' then 'Metal push switches'
                     when requirement ~* 'circular|\mgx\M|aviation|m12|waterproof' then 'Circular & GX connectors'
                     when requirement ~* '\mbnc\M|\msma\M|\muhf\M|\mrf\M|coax' then 'BNC / SMA / UHF (RF)'
                     when requirement ~* 'hdmi|cable|vga|dvi|\mav\M|audio.?video|converter' then 'HDMI & AV cables'
                     when requirement ~* 'speaker|horn|tweeter|xlr|speakon|amplifier|audio' then 'Audio & PA'
                     when requirement ~* 'solar|mc4' then 'Solar (MC4)'
                     when requirement ~* 'power|sb50|\mdc\M|plug|socket' then 'Power connectors'
                   end b from l) y
                 where b is not null group by b order by c desc limit 6) z),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', s, 'count', c) order by c desc), '[]'::jsonb)
                 from (select btrim(state) s, count(*) c from l where btrim(state) <> '' group by 1) x)
  )
$$;

-- service_role only: daily digest content (legacy sendDailyDigest).
create or replace function public.digest_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select e.enq_code, e.customer_name, e.company, e.phone, e.priority, e.stage, e.next_follow_up,
           coalesce(t.name, 'Unassigned') owner_name
      from public.enquiries e left join public.team_members t on t.id = e.owner_id
     where e.active and e.archived_at is null and e.stage in ('New','Quoted','Follow-up') and e.next_follow_up <= private.today()
  )
  select jsonb_build_object(
    'date', private.today(),
    'overdue', (select coalesce(jsonb_agg(to_jsonb(l) order by next_follow_up), '[]'::jsonb) from l where next_follow_up < private.today()),
    'today', (select coalesce(jsonb_agg(to_jsonb(l) order by owner_name), '[]'::jsonb) from l where next_follow_up = private.today()),
    'pending_approvals', (select count(*) from public.pending_enquiries where status = 'Pending'),
    'new_yesterday', (select count(*) from public.enquiries where enq_date = private.today() - 1 and active),
    -- Configured recipients, else every active admin with an email.
    'recipients', coalesce(
      (select case when jsonb_array_length(value) > 0 then value end from private.app_settings where key = 'digest_recipients'),
      (select coalesce(jsonb_agg(email), '[]'::jsonb) from public.profiles where role = 'admin' and active and coalesce(email, '') <> '')))
$$;
