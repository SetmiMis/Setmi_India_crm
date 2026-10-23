import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { userClient } from "@/lib/supabase/server";
import { isConfigured, env } from "@/lib/env";
import { revokeShareLink, setHoliday } from "@/server/actions/admin";
import { PageHeader, Card, EmptyState } from "@/components/ui/layout";
import { Pill } from "@/components/ui/badges";
import { ActionButton } from "@/components/action-form";
import { niceDate, niceTimestamp } from "@/lib/domain/dates";
import { ArchiveForm, HolidayForm, MetricsKeyForm, SettingsForm, ShareLinkForm } from "./admin-forms";

export const metadata: Metadata = { title: "Admin Settings" };

type ShareLink = { id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; use_count: number };
type Job = { job: string; run_key: string; status: string; started_at: string; finished_at: string | null; details: Record<string, unknown> };
type Audit = { at: string; actor_label: string; action: string; entity: string; entity_id: string; details: Record<string, unknown> };

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await userClient();
  const [settings, links, metrics, jobs, audit, { data: holidays }] = await Promise.all([
    readRpc<Record<string, unknown>>("admin_get_settings"),
    readRpc<ShareLink[]>("admin_list_share_links"),
    readRpc<{ active: boolean; created_at: string | null; last_used_at: string | null }>("admin_metrics_key_status"),
    readRpc<Job[]>("admin_recent_jobs"),
    readRpc<Audit[]>("admin_audit_log", { p_limit: 60, p_entity: null }),
    supabase.from("holidays").select("day, label").order("day", { ascending: false }).limit(60),
  ]);
  const integrations: Array<[string, boolean, string]> = [
    ["OMS bridge", isConfigured("oms"), "OMS_URL, OMS_INGEST_TOKEN"],
    ["Email (daily digest, password reset links use Supabase)", isConfigured("smtp"), "SMTP_HOST, SMTP_FROM, …"],
    ["Meta Ads Google Sheet", isConfigured("metaSheet"), "META_SHEET_ID + Google service account"],
    ["Scheduled jobs endpoint", Boolean(env().CRON_SECRET), "CRON_SECRET"],
    ["Public base URL", Boolean(env().APP_BASE_URL), "APP_BASE_URL"],
  ];

  return (
    <>
      <PageHeader title="Admin Settings" subtitle="Business settings, public links, integrations and the audit trail." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Business settings"><SettingsForm settings={settings} /></Card>
        <Card title="Integrations">
          <ul className="space-y-2 text-sm">
            {integrations.map(([name, ok, vars]) => (
              <li key={name} className="flex items-start justify-between gap-2">
                <span>{name}<br /><span className="text-xs text-muted">{vars}</span></span>
                {ok ? <Pill tone="good">Configured</Pill> : <Pill tone="warn">Not configured</Pill>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">“Configured” means the settings are present on this server; live connections are verified by using the feature (see docs/OPERATIONS_AND_MAINTENANCE.md).</p>
        </Card>

        <Card title="Company holidays (skipped by follow-up dates)">
          <HolidayForm />
          <ul className="mt-3 divide-y divide-line text-sm">
            {(holidays ?? []).map((h) => (
              <li key={h.day} className="flex items-center justify-between py-1.5">
                <span>{niceDate(h.day)} — {h.label}</span>
                <ActionButton action={setHoliday} fields={{ day: h.day, present: "false" }} label="Remove" variant="ghost" />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Archive closed-out enquiries">
          <ArchiveForm defaultMonths={Number(settings?.archive_after_months ?? 6)} />
        </Card>

        <Card title="Data Analysis share links">
          <ShareLinkForm />
          {links.length === 0 ? <EmptyState title="No share links yet" /> : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {links.map((l) => {
                const live = !l.revoked_at && new Date(l.expires_at) > new Date();
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>
                      <b>{l.label || "Untitled"}</b> {live ? <Pill tone="good">live</Pill> : <Pill tone="bad">{l.revoked_at ? "revoked" : "expired"}</Pill>}
                      <br /><span className="text-xs text-muted">expires {niceTimestamp(l.expires_at)} · used {l.use_count}× {l.last_used_at ? `· last ${niceTimestamp(l.last_used_at)}` : ""}</span>
                    </span>
                    {live ? <ActionButton action={revokeShareLink} fields={{ id: l.id }} label="Revoke" variant="danger" confirm="Revoke this link? Anyone using it loses access." /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Public website metrics feed">
          <p className="mb-2 text-sm">
            Status: {metrics.active ? <Pill tone="good">enabled</Pill> : <Pill tone="warn">disabled</Pill>}
            {metrics.last_used_at ? <span className="text-xs text-muted"> · last used {niceTimestamp(metrics.last_used_at)}</span> : null}
          </p>
          <p className="mb-3 text-xs text-muted">Counts only — no names, phones, values, rep names, win/loss or backlog. URL: <code>/api/public/metrics</code> with header <code>Authorization: Bearer &lt;key&gt;</code>.</p>
          <MetricsKeyForm active={metrics.active} />
        </Card>

        <Card title="Scheduled jobs (latest)" className="xl:col-span-2 p-0">
          {jobs.length === 0 ? <EmptyState title="No job runs yet" /> : (
            <div className="overflow-x-auto"><table className="data">
              <thead><tr><th>Job</th><th>Run</th><th>Status</th><th>Started</th><th>Details</th></tr></thead>
              <tbody>{jobs.map((j) => (
                <tr key={`${j.job}-${j.run_key}`}><td>{j.job}</td><td>{j.run_key}</td><td><Pill tone={j.status === "succeeded" ? "good" : j.status === "failed" ? "bad" : "neutral"}>{j.status}</Pill></td><td>{niceTimestamp(j.started_at)}</td><td className="text-xs">{JSON.stringify(j.details).slice(0, 160)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card title="Audit trail (latest 60)" className="xl:col-span-2 p-0">
          <div className="max-h-[480px] overflow-auto"><table className="data">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>{audit.map((a, i) => (
              <tr key={i}><td className="whitespace-nowrap">{niceTimestamp(a.at)}</td><td>{a.actor_label || "system"}</td><td>{a.action}</td><td>{a.entity} {a.entity_id}</td><td className="text-xs">{JSON.stringify(a.details).slice(0, 140)}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
