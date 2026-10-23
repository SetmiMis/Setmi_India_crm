-- =============================================================================
-- SETMI INDIA CRM — Row Level Security, grants and function execution rights
--
--  * anon: NO table access and NO function access at all. Public features
--    (enquiry form, metrics feed, share links) go through the Next.js server,
--    which calls service_role-only functions after validation + rate limiting.
--  * authenticated: SELECT only, filtered by RLS; every write goes through a
--    SECURITY DEFINER function that authorizes the caller.
--  * service_role: Supabase's server role (bypasses RLS). Never sent to browsers.
-- =============================================================================

-- ---------- Table privileges ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

grant select on
  public.lead_sources, public.india_states, public.pincode_geo, public.holidays,
  public.profiles, public.team_members, public.customers, public.enquiries, public.enquiry_stage_history,
  public.pending_enquiries, public.follow_ups, public.call_logs, public.enquiry_transfers,
  public.import_batches, public.oms_order_requests
to authenticated;

grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;

-- ---------- RLS: enable everywhere in exposed schema ----------
alter table public.lead_sources          enable row level security;
alter table public.india_states          enable row level security;
alter table public.pincode_geo           enable row level security;
alter table public.holidays              enable row level security;
alter table public.profiles              enable row level security;
alter table public.team_members          enable row level security;
alter table public.customers             enable row level security;
alter table public.enquiries             enable row level security;
alter table public.enquiry_stage_history enable row level security;
alter table public.pending_enquiries     enable row level security;
alter table public.external_lead_refs    enable row level security;
alter table public.follow_ups            enable row level security;
alter table public.call_logs             enable row level security;
alter table public.enquiry_transfers     enable row level security;
alter table public.import_batches        enable row level security;
alter table public.oms_order_requests    enable row level security;

-- Policies are idempotent: drop-if-exists then create.
do $$
declare
  r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and policyname like 'crm_%' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;

-- Reference data: any active signed-in user.
create policy crm_ref_read on public.lead_sources  for select to authenticated using ((select private.is_active_user()));
create policy crm_ref_read on public.india_states  for select to authenticated using ((select private.is_active_user()));
create policy crm_ref_read on public.pincode_geo   for select to authenticated using ((select private.is_active_user()));
create policy crm_ref_read on public.holidays      for select to authenticated using ((select private.is_active_user()));

-- Profiles: yourself; admins see everyone.
create policy crm_profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

-- Team roster names: needed for Lead By / transfer pickers.
create policy crm_team_read on public.team_members for select to authenticated using ((select private.is_active_user()));

-- Enquiries: admins all; reps their own, plus a lead with a transfer addressed to them.
create policy crm_enquiries_read on public.enquiries for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and owner_id = (select private.current_member_id()))
    or ((select private.is_active_user()) and exists (
          select 1 from public.enquiry_transfers t
           where t.enquiry_id = enquiries.id and t.status = 'Proposed' and t.to_member_id = (select private.current_member_id())))
  );

-- Child rows follow the enquiry they belong to (the subquery is itself RLS-filtered).
create policy crm_stage_history_read on public.enquiry_stage_history for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = enquiry_stage_history.enquiry_id));
create policy crm_follow_ups_read on public.follow_ups for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = follow_ups.enquiry_id));
create policy crm_call_logs_read on public.call_logs for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = call_logs.enquiry_id));
create policy crm_oms_read on public.oms_order_requests for select to authenticated
  using (exists (select 1 from public.enquiries e where e.id = oms_order_requests.enquiry_id));

-- Customers: admins all; reps only customers of their own leads (legacy exposed all — BUG-020).
create policy crm_customers_read on public.customers for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and exists (
          select 1 from public.enquiries e where e.customer_id = customers.id and e.owner_id = (select private.current_member_id())))
  );

-- Pending approvals: admins all; others only what they submitted.
create policy crm_pending_read on public.pending_enquiries for select to authenticated
  using ((select private.is_admin()) or ((select private.is_active_user()) and submitted_by = (select auth.uid())));

-- Transfers: the two parties and admins.
create policy crm_transfers_read on public.enquiry_transfers for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and (select private.current_member_id()) in (from_member_id, to_member_id))
  );

create policy crm_batches_read on public.import_batches for select to authenticated
  using ((select private.is_admin()) or ((select private.is_active_user()) and created_by = (select auth.uid())));

-- external_lead_refs: no policy → no access for authenticated (service_role only).

-- ---------- Function execution ----------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Helpers referenced inside RLS policies must be executable by the querying role.
grant execute on function private.is_active_user(), private.is_admin(), private.current_member_id() to authenticated;
grant execute on function public.phone_key(text) to authenticated;

-- Signed-in user API (each function authorizes internally).
grant execute on function
  public.create_pending_enquiry(jsonb),
  public.bulk_create_pending(jsonb, text),
  public.update_pending_enquiry(uuid, jsonb),
  public.approve_pending(uuid, uuid),
  public.reject_pending(uuid, text),
  public.claim_enquiry(uuid, text),
  public.propose_transfer(uuid, uuid),
  public.respond_transfer(uuid, boolean),
  public.cancel_transfer(uuid),
  public.update_enquiry(uuid, jsonb, integer),
  public.move_stage(uuid, text, jsonb, integer),
  public.log_call(uuid, jsonb),
  public.add_note(uuid, text),
  public.soft_delete_enquiry(uuid, text),
  public.restore_enquiry(uuid),
  public.archive_closed_enquiries(integer),
  public.restore_archived_enquiry(uuid),
  public.create_customer(jsonb),
  public.update_customer(uuid, jsonb),
  public.customer_by_phone(text),
  public.check_phone_duplicate(text),
  public.admin_add_team_member(text),
  public.admin_set_team_member_active(uuid, boolean),
  public.admin_get_settings(),
  public.admin_set_setting(text, jsonb),
  public.admin_set_holiday(date, text, boolean),
  public.admin_create_share_link(text, text, timestamptz),
  public.admin_list_share_links(),
  public.admin_revoke_share_link(uuid),
  public.admin_set_metrics_key(text, text),
  public.admin_metrics_key_status(),
  public.admin_recent_jobs(),
  public.admin_audit_log(integer, text),
  public.import_external_leads(text, jsonb, text, text, uuid),
  public.oms_begin_order(uuid, uuid),
  public.dashboard(jsonb),
  public.available_leads(integer, integer, text),
  public.follow_ups_due(),
  public.follow_up_badge_counts(),
  public.call_dashboard(),
  public.reports_summary(date, date),
  public.team_performance(),
  public.list_customers(text, integer, integer),
  public.analysis_rows(),
  public.won_customers_list(),
  public.map_aggregate(jsonb)
to authenticated;

-- Server-only API (Next.js server with the secret key).
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
grant usage on schema private to service_role;

-- ---------- Storage: private bucket for enquiry PDFs (legacy shared them "anyone with link" — SEC-08) ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('enquiry-documents', 'enquiry-documents', false, 10485760, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
  end if;
end;
$$;
-- No storage.objects policies are created for this bucket: only the server (service_role)
-- uploads, and it hands out short-lived signed URLs after checking the caller can see the row.
