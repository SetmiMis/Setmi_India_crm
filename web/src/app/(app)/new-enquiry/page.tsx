import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { leadSources, teamMembers } from "@/server/queries";
import { PageHeader, Card } from "@/components/ui/layout";
import { NewEnquiryForm } from "./new-enquiry-form";

export const metadata: Metadata = { title: "New Enquiry" };

export default async function NewEnquiryPage() {
  const user = await requireUser();
  const [sources, team] = await Promise.all([leadSources(), teamMembers()]);
  return (
    <>
      <PageHeader title="New Enquiry" subtitle="Every new lead is reviewed in Pending Approvals before it enters the pipeline." />
      <Card>
        <NewEnquiryForm sources={sources} team={team.map((t) => ({ id: t.id, name: t.name }))} myMemberId={user.memberId} />
      </Card>
    </>
  );
}
