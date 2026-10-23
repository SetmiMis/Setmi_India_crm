import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { userClient, serviceClient } from "@/lib/supabase/server";

// Enquiry PDFs live in a PRIVATE bucket (legacy shared them "anyone with the link" — SEC-08).
// The row is read as the user first, so RLS decides access; only then is a 60-second signed URL issued.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { kind, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== "enquiry" && kind !== "pending")) return NextResponse.json({ error: "not found" }, { status: 404 });
  const supabase = await userClient();
  const { data } = await supabase
    .from(kind === "enquiry" ? "enquiries" : "pending_enquiries")
    .select("attachment_path")
    .eq("id", id)
    .maybeSingle();
  const path = data?.attachment_path;
  if (!path) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: signed } = await serviceClient().storage.from("enquiry-documents").createSignedUrl(path, 60);
  if (!signed?.signedUrl) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
