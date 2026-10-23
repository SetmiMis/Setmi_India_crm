import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { getEnquiry, leadSources, teamMembers } from "@/server/queries";
import { cancelTransfer, restoreArchived, restoreEnquiry, softDeleteEnquiry } from "@/server/actions/enquiries";
import { PageHeader, Card, DefinitionList, Notice } from "@/components/ui/layout";
import { GradeBadge, PriorityBadge, StageBadge, FollowUpBadge, Pill } from "@/components/ui/badges";
import { ActionButton } from "@/components/action-form";
import { LinkButton } from "@/components/ui/button";
import { niceDate, niceTimestamp } from "@/lib/domain/dates";
import { nextStages, OPEN_STAGES, type Stage } from "@/lib/domain/constants";
import { waLink } from "@/lib/domain/whatsapp";
import { inr } from "@/lib/cn";
import { isConfigured } from "@/lib/env";
import { EditEnquiryForm, StageMoveForm, CallLogForm, NoteForm, TransferForm } from "./forms";
import { OmsPanel } from "./oms-panel";

export const metadata: Metadata = { title: "Enquiry" };

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getEnquiry(id);
  if (!data) notFound();
  const { enquiry: e, followUps, calls, history, transfers } = data;
  const [team, sources] = await Promise.all([teamMembers(), leadSources()]);
  const isOwner = !!user.memberId && e.owner_id === user.memberId;
  const canAct = (user.isAdmin || isOwner) && e.active && !e.archived_at;
  const openTransfer = transfers.find((t) => t.status === "Proposed");
  const ownerName = (e.owner as { name: string } | null)?.name ?? null;
  const wa = { ...e, owner_name: ownerName } as Parameters<typeof waLink>[0];
  const isOpen = (OPEN_STAGES as readonly string[]).includes(e.stage);
  const str = (k: string) => (e[k] == null ? "" : String(e[k]));

  return (
    <>
      <PageHeader
        title={e.customer_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-ink">{e.enq_code}</span>
            <StageBadge stage={e.stage} />
            <PriorityBadge priority={e.priority} />
            <GradeBadge grade={e.grade} />
            {e.escalation ? <Pill tone="warn">Escalation: {e.escalation}</Pill> : null}
            {!e.active ? <Pill tone="bad">Deleted</Pill> : null}
            {e.archived_at ? <Pill>Archived</Pill> : null}
          </span>
        }
        actions={
          <>
            {e.phone ? <a className="rounded-[10px] border border-line bg-panel px-3 py-2 text-sm font-semibold hover:bg-chip" href={`tel:${e.phone}`}>📞 Call</a> : null}
            {waLink(wa, "welcome") ? <a className="rounded-[10px] border border-line bg-panel px-3 py-2 text-sm font-semibold text-green-dk hover:bg-chip" href={waLink(wa, "welcome")!} target="_blank" rel="noopener noreferrer">WhatsApp welcome</a> : null}
            {waLink(wa, "follow") ? <a className="rounded-[10px] border border-line bg-panel px-3 py-2 text-sm font-semibold text-green-dk hover:bg-chip" href={waLink(wa, "follow")!} target="_blank" rel="noopener noreferrer">WhatsApp follow-up</a> : null}
            <LinkButton href="/pipeline" variant="ghost">← Pipeline</LinkButton>
          </>
        }
      />

      {openTransfer && openTransfer.to_member_id === user.memberId ? (
        <div className="mb-4"><Notice tone="info">{openTransfer.from?.name ?? "A colleague"} wants to transfer this lead to you — accept or decline it on the <Link className="underline" href="/pipeline">Pipeline</Link> page.</Notice></div>
      ) : null}
      {!canAct && e.active && !e.archived_at ? <div className="mb-4"><Notice tone="warn">View only — this lead belongs to {ownerName ?? "nobody yet"}.</Notice></div> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <Card title="Details">
            <DefinitionList
              items={[
                ["Company", str("company")],
                ["Phone", str("phone")],
                ["Email", str("email")],
                ["GSTIN", str("gst")],
                ["Location", [str("city"), str("district"), str("state"), str("pincode")].filter(Boolean).join(", ")],
                ["Source", str("source")],
                ["Requirement", str("requirement")],
                ["Qty / Timeline", [str("qty"), str("timeline")].filter(Boolean).join(" · ")],
                ["Lead By", ownerName ?? "Unassigned"],
                ["Enquiry date", niceDate(str("enq_date"))],
                ["Last contact", niceDate(str("last_contact"))],
                ["Next follow-up", e.next_follow_up ? <span key="nf">{niceDate(e.next_follow_up)} <FollowUpBadge date={e.next_follow_up} /></span> : ""],
                ["Est. value", e.est_value ? inr(e.est_value) : ""],
                ["Quote", [str("quote_no"), e.quote_amount ? inr(e.quote_amount) : "", niceDate(str("quote_date"))].filter(Boolean).join(" · ")],
                ["Invoice", str("invoice_no")],
                ["Order value", e["order_value"] ? inr(Number(e["order_value"])) : ""],
                ["Lost reason", str("lost_reason")],
                ["Dispatch", [niceDate(str("dispatch_date")), str("dispatch_info"), e["shipment_weight"] ? `${e["shipment_weight"]} kg` : ""].filter(Boolean).join(" · ")],
                ["Feedback", e["feedback_rating"] ? `${"★".repeat(Number(e["feedback_rating"]))} ${str("feedback_note")}` : ""],
                ["OMS order", str("oms_order_id")],
                ["Customer record", (e["customer"] as { id: string; cust_code: string } | null) ? <Link key="c" className="text-cyan-dk underline" href={`/customers?q=${encodeURIComponent(e.phone)}`}>{(e["customer"] as { cust_code: string }).cust_code}</Link> : ""],
                ["Document", str("attachment_path") ? <a key="d" className="text-cyan-dk underline" href={`/api/attachments/enquiry/${e.id}`} target="_blank" rel="noopener noreferrer">View PDF</a> : ""],
              ]}
            />
            {str("notes") ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-chip p-2.5 text-[13px]">{str("notes")}</p> : null}
          </Card>

          {canAct && isOpen ? (
            <Card title="Log a call" className="scroll-mt-4" >
              <div id="log-call" />
              <CallLogForm id={e.id} callsSoFar={calls.length} />
            </Card>
          ) : null}

          <Card title={`Activity (${calls.length} calls · ${followUps.length} notes/outcomes)`}>
            {calls.length ? (
              <div className="mb-4 overflow-x-auto">
                <table className="data">
                  <thead><tr><th>#</th><th>Date</th><th>Status</th><th>Interest</th><th>By</th><th>Remarks</th><th>Next</th></tr></thead>
                  <tbody>
                    {calls.map((c) => (
                      <tr key={c.id}>
                        <td>{c.call_number}</td><td className="whitespace-nowrap">{niceDate(c.call_date)}</td><td>{c.call_status}</td>
                        <td>{c.interest ?? "—"}</td><td>{c.employee_label}</td><td className="max-w-[240px]">{c.remarks}</td>
                        <td className="whitespace-nowrap">{niceDate(c.next_follow_up)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <ol className="space-y-2 text-sm">
              {[...followUps.map((f) => ({ at: f.created_at, kind: f.mode, text: f.mode === "Call" ? f.outcome : f.note, by: f.by_label })),
                ...history.map((h) => ({ at: h.changed_at, kind: "Stage", text: `${h.from_stage ?? "—"} → ${h.to_stage}${h.note ? ` · ${h.note}` : ""}`, by: "" }))]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map((t, i) => (
                  <li key={i} className="flex gap-2 border-l-2 border-cyan/40 pl-2.5">
                    <span className="w-36 shrink-0 text-xs text-muted">{niceTimestamp(t.at)}</span>
                    <span><b>{t.kind}</b> {t.text} {t.by ? <span className="text-muted">— {t.by}</span> : null}</span>
                  </li>
                ))}
            </ol>
            {canAct ? <div className="mt-4"><NoteForm id={e.id} /></div> : null}
          </Card>
        </div>

        <div className="space-y-4">
          {canAct && nextStages(e.stage as Stage, user.isAdmin).length > 0 ? (
            <Card title="Move stage">
              <StageMoveForm id={e.id} version={e.version} stage={e.stage} options={nextStages(e.stage as Stage, user.isAdmin)} />
            </Card>
          ) : null}

          {canAct && isOpen ? (
            <Card title="Record order in OMS">
              <OmsPanel id={e.id} configured={isConfigured("oms")} linkedOrder={str("oms_order_id") || null} />
            </Card>
          ) : str("oms_order_id") ? (
            <Card title="OMS order">
              <OmsPanel id={e.id} configured={isConfigured("oms")} linkedOrder={str("oms_order_id")} />
            </Card>
          ) : null}

          {canAct ? (
            <Card title="Transfer lead">
              {openTransfer ? (
                <div className="space-y-2 text-sm">
                  <p>Waiting for <b>{openTransfer.to?.name}</b> to accept (proposed {niceTimestamp(openTransfer.proposed_at)}).</p>
                  <ActionButton action={cancelTransfer} fields={{ transfer_id: openTransfer.id }} label="Cancel transfer" variant="secondary" />
                </div>
              ) : e.owner_id ? (
                <TransferForm id={e.id} team={team.filter((t) => t.id !== e.owner_id)} />
              ) : (
                <p className="text-sm text-muted">Unclaimed leads are picked up from Available Leads.</p>
              )}
            </Card>
          ) : null}

          {canAct ? (
            <Card title="Edit enquiry">
              <EditEnquiryForm
                enquiry={{
                  id: e.id, version: e.version, customer_name: e.customer_name, company: str("company"), phone: e.phone, email: str("email"),
                  gst: str("gst"), pincode: str("pincode"), district: str("district"), state: str("state"), city: str("city"),
                  source: e.source, requirement: e.requirement, est_value: str("est_value"), quote_amount: str("quote_amount"),
                  order_value: str("order_value"), shipment_weight: str("shipment_weight"), priority: e.priority ?? "",
                  next_follow_up: e.next_follow_up ?? "", qty: str("qty"), timeline: str("timeline"), escalation: str("escalation"),
                  owner_id: e.owner_id ?? "", isOpen,
                }}
                sources={sources}
                team={user.isAdmin ? team : null}
              />
            </Card>
          ) : null}

          <Card title="Danger zone">
            {e.active ? (
              canAct ? (
                <ActionButton action={softDeleteEnquiry} fields={{ id: e.id, reason: "deleted from detail page" }} label="Delete enquiry" variant="danger"
                  confirm={`Delete ${e.enq_code} — ${e.customer_name}? Use this only for wrong or duplicate entries. An admin can restore it.`} />
              ) : <p className="text-sm text-muted">Only the owner or an admin can delete.</p>
            ) : user.isAdmin ? (
              <ActionButton action={restoreEnquiry} fields={{ id: e.id }} label="Restore enquiry" variant="success" />
            ) : null}
            {e.archived_at && user.isAdmin ? (
              <div className="mt-2"><ActionButton action={restoreArchived} fields={{ id: e.id }} label="Restore from archive" variant="secondary" /></div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
