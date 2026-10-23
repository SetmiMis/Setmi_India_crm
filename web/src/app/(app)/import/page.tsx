import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { teamMembers } from "@/server/queries";
import { isConfigured } from "@/lib/env";
import { PageHeader, Card } from "@/components/ui/layout";
import { BulkImport, MetaImport } from "./importers";

export const metadata: Metadata = { title: "Bulk Import" };

export default async function ImportPage() {
  const user = await requireUser();
  const team = await teamMembers();
  return (
    <>
      <PageHeader title="Bulk Import" subtitle="Upload a CSV or Excel file, map its columns, and every row goes to Pending Approvals." />
      <Card title="Leads from CSV / Excel">
        <BulkImport team={team.map((t) => ({ id: t.id, name: t.name }))} />
      </Card>
      {user.isAdmin ? (
        <Card title="Meta Ads leads" className="mt-4">
          <MetaImport sheetConfigured={isConfigured("metaSheet")} />
        </Card>
      ) : null}
    </>
  );
}
