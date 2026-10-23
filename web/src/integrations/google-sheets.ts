import "server-only";
import { createSign } from "node:crypto";
import { env } from "@/lib/env";
import type { Row } from "@/lib/domain/imports";

// Read-only Google Sheets access with a service account (replaces Apps Script's
// SpreadsheetApp.openById for the Meta Ads leads sheet). The sheet must be shared with
// GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer. Scope is read-only.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function b64url(s: string | Buffer) {
  return Buffer.from(s).toString("base64url");
}

async function accessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const e = env();
  const email = e.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = e.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${signer.sign(key).toString("base64url")}`;
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}).`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token response had no access_token.");
  return json.access_token;
}

/** Every tab of the spreadsheet as header-keyed rows (legacy importer read all tabs too). */
export async function readAllTabs(spreadsheetId: string, fetchImpl: typeof fetch = fetch): Promise<Array<{ tab: string; headers: string[]; rows: Row[] }>> {
  if (!/^[\w-]{20,100}$/.test(spreadsheetId)) throw new Error("Invalid spreadsheet id.");
  const token = await accessToken(fetchImpl);
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, { headers: auth, cache: "no-store" });
  if (!meta.ok) throw new Error(`Could not open the leads sheet (${meta.status}). Is it shared with the service account?`);
  const tabs = ((await meta.json()) as { sheets?: Array<{ properties: { title: string } }> }).sheets?.map((s) => s.properties.title) ?? [];
  const out: Array<{ tab: string; headers: string[]; rows: Row[] }> = [];
  for (const tab of tabs.slice(0, 20)) {
    const r = await fetchImpl(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}?valueRenderOption=FORMATTED_VALUE`,
      { headers: auth, cache: "no-store" },
    );
    if (!r.ok) continue;
    const values = ((await r.json()) as { values?: string[][] }).values ?? [];
    if (values.length < 2) continue;
    const headers = values[0].map((h) => String(h));
    out.push({
      tab,
      headers,
      rows: values.slice(1, 5001).map((v) => Object.fromEntries(headers.map((h, i) => [h, String(v[i] ?? "")]))),
    });
  }
  return out;
}
