-- Covering indexes for foreign keys used in joins/filters (Supabase performance advisor 0001).
-- Audit-only FKs (created_by, decided_by, …) are left unindexed on purpose: they are never filtered on
-- and profiles are never deleted (ON DELETE RESTRICT/SET NULL on rare admin action).
create index if not exists transfers_from_idx          on public.enquiry_transfers (from_member_id);
create index if not exists pending_owner_idx           on public.pending_enquiries (owner_id);
create index if not exists pending_batch_idx           on public.pending_enquiries (import_batch_id);
create index if not exists pending_source_idx          on public.pending_enquiries (source);
create index if not exists external_refs_pending_idx   on public.external_lead_refs (pending_id);
create index if not exists external_refs_enquiry_idx   on public.external_lead_refs (enquiry_id);
create index if not exists external_refs_batch_idx     on public.external_lead_refs (batch_id);
