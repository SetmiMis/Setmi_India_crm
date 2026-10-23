import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { PageHeader, Card } from "@/components/ui/layout";

export const metadata: Metadata = { title: "How it Works" };

const steps: Array<[string, string]> = [
  ["1. Intake", "Every new lead — New Enquiry, the public enquiry form, Bulk Import and (by default) Meta Ads — goes to Pending Approvals first. Nothing reaches the pipeline unreviewed."],
  ["2. Approval", "An admin approves or rejects (a reason is required). Approved leads with a Lead By go straight to that person; the rest appear on Available Leads."],
  ["3. Claim", "On Available Leads, call the customer, judge the priority (Hot / Warm / Cold), and claim it. Only one person can claim a lead."],
  ["4. Calls & follow-ups", "Log every call on the enquiry. The next follow-up is set automatically: Hot every working day, Warm every 2 working days, Cold every 6 (Sundays and company holidays skipped). The first call moves a New or Quoted lead to Follow-up."],
  ["5. Grading", "Enter Qty and buyer timeline to get a Grade: A (high value / high probability), B (standard) or C (low-touch). Use Escalation for Proprietor or Shop Floor attention."],
  ["6. Quote → Won", "Move to Quoted with the quote number and amount. Mark Won with the invoice number — or record the order in OMS, which marks it Won automatically."],
  ["7. Dispatch → Closed", "After Won, record dispatch (courier details and weight), then close with the customer’s feedback rating. Lost needs a reason."],
  ["8. Hand-over", "To give a lead to a colleague, propose a Transfer; it moves only when they accept. Admins can reassign directly."],
];

export default async function GuidePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="How it Works" subtitle="SETMI INDIA Enquiry-to-Order flow" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {steps.map(([t, d]) => (
          <Card key={t} title={t}><p className="text-sm leading-relaxed">{d}</p></Card>
        ))}
      </div>
      <Card title="Who can see what" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Sales reps see and work only their own leads, plus Available Leads and transfers offered to them.</li>
          <li>Admins see everything, approve leads, manage users, run reports and change settings.</li>
          <li>{user.isAdmin ? "You are an admin." : "You are a sales rep."} Every change is recorded in the audit trail with your name.</li>
        </ul>
      </Card>
    </>
  );
}
