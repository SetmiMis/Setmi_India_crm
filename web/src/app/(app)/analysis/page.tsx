import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { toAnalysisRows } from "@/server/analysis";
import { PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/button";
import { AnalysisExplorer } from "@/components/analysis-explorer";

export const metadata: Metadata = { title: "Data Analysis" };

export default async function AnalysisPage() {
  const user = await requireUser();
  const raw = await readRpc<Parameters<typeof toAnalysisRows>[0]>("analysis_rows");
  return (
    <>
      <PageHeader
        title="Data Analysis"
        subtitle={`${user.isAdmin ? "All" : "Your"} ${raw.length.toLocaleString("en-IN")} enquiries — filter and break down instantly. No names or phone numbers here.`}
        actions={<LinkButton href="/api/export/won-customers" prefetch={false}>Won customers (CSV)</LinkButton>}
      />
      <AnalysisExplorer rows={toAnalysisRows(raw, false)} shared={false} />
    </>
  );
}
