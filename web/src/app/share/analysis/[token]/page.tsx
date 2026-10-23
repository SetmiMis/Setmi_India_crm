import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { serviceClient } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { toAnalysisRows } from "@/server/analysis";
import { AnalysisExplorer } from "@/components/analysis-explorer";
import { COMPANY } from "@/lib/domain/constants";

export const metadata: Metadata = { title: "Enquiry analysis", robots: { index: false, follow: false }, referrer: "no-referrer" };

function Invalid() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="logo text-3xl">SETMI <span className="in">INDIA</span></div>
      <p className="mt-4">This link is not valid or has expired.</p>
    </main>
  );
}

// Public, PII-free analysis view (legacy ?page=analysis&key=…). Links are random 256-bit tokens;
// only their SHA-256 is stored; each has an expiry and can be revoked.
export default async function SharedAnalysisPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return <Invalid />;
  if (!(await rateLimit("share", [await clientIp()], 60, 600))) return <Invalid />;
  const svc = serviceClient();
  const { data: ok } = await svc.rpc("resolve_share_link", { p_token_hash: createHash("sha256").update(token).digest("hex") });
  if (ok !== true) return <Invalid />;
  const { data } = await svc.rpc("analysis_rows_shared");
  const rows = toAnalysisRows((data ?? []) as Parameters<typeof toAnalysisRows>[0], true);
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      <div className="mb-4">
        <div className="logo text-2xl">SETMI <span className="in">INDIA</span></div>
        <p className="text-xs text-muted">{COMPANY.tagline} · Enquiry analysis (no personal data)</p>
      </div>
      <AnalysisExplorer rows={rows} shared />
    </main>
  );
}
