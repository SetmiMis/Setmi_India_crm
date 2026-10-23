import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";

// OMS adapter. Contract reverse-engineered from the legacy src/OmsBridge.js (NOT yet verified
// against a live OMS — see docs/API_CONTRACTS.md):
//   GET  {OMS_URL}/api/ingest/products            → { ok, products:[...] }
//   POST {OMS_URL}/api/ingest/order               → { ok, orderId } | { ok:false, msg }
//   GET  {OMS_URL}/api/ingest/order/{orderId}     → { ok, ...status, piUrl? }
//   POST {OMS_URL}/api/ingest/order/{orderId}     → body { action:'piSent'|'payment', ... }
// Auth: "Authorization: Bearer {OMS_INGEST_TOKEN}". Legacy sent no idempotency key; we send
// the enquiry code (enqId) and an Idempotency-Key header that a compliant OMS may honour.

export class OmsError extends Error {
  constructor(message: string, readonly kind: "not_configured" | "timeout" | "http" | "rejected" | "bad_response") {
    super(message);
  }
}

const okEnvelope = z.object({ ok: z.boolean(), msg: z.string().optional() }).loose();

async function omsFetch(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string, fetchImpl: typeof fetch = fetch) {
  const e = env();
  if (!e.OMS_URL || !e.OMS_INGEST_TOKEN) throw new OmsError("OMS is not configured (OMS_URL / OMS_INGEST_TOKEN).", "not_configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), e.OMS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(e.OMS_URL.replace(/\/+$/, "") + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${e.OMS_INGEST_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new OmsError(`OMS returned an unexpected response (${res.status}).`, "bad_response");
    }
    const env_ = okEnvelope.safeParse(json);
    if (!env_.success) throw new OmsError(`OMS returned an unexpected response (${res.status}).`, "bad_response");
    if (!env_.data.ok) throw new OmsError(env_.data.msg || `OMS rejected the request (${res.status}).`, "rejected");
    return env_.data as Record<string, unknown>;
  } catch (err) {
    if (err instanceof OmsError) throw err;
    if ((err as Error).name === "AbortError") throw new OmsError("OMS did not respond in time.", "timeout");
    throw new OmsError("Could not reach the OMS.", "http");
  } finally {
    clearTimeout(timer);
  }
}

export type OmsProduct = { id: string; name: string; unit?: string };

export async function listProducts(fetchImpl?: typeof fetch): Promise<OmsProduct[]> {
  const r = await omsFetch("GET", "/api/ingest/products", undefined, undefined, fetchImpl);
  const arr = Array.isArray(r.products) ? r.products : [];
  return arr
    .map((p: Record<string, unknown>) => ({ id: String(p.id ?? p._id ?? ""), name: String(p.name ?? p.title ?? ""), unit: p.unit ? String(p.unit) : undefined }))
    .filter((p: OmsProduct) => p.id && p.name);
}

export type OmsOrderInput = {
  enqId: string;
  customer: { company: string; contact: string; phone: string; whatsapp: string; email: string; gst: string };
  items: Array<{ productId: string; qty: number; remarks?: string }>;
  note: string;
  quoteNo: string;
};

export async function createOrder(input: OmsOrderInput, idempotencyKey: string, fetchImpl?: typeof fetch): Promise<string> {
  const r = await omsFetch("POST", "/api/ingest/order", input, idempotencyKey, fetchImpl);
  const id = typeof r.orderId === "string" ? r.orderId : null;
  if (!id || !/^[\w.-]{1,60}$/.test(id)) throw new OmsError("OMS did not return a valid order id.", "bad_response");
  return id;
}

export async function getOrder(orderId: string, fetchImpl?: typeof fetch) {
  return omsFetch("GET", `/api/ingest/order/${encodeURIComponent(orderId)}`, undefined, undefined, fetchImpl);
}

export async function orderAction(orderId: string, body: Record<string, unknown>, fetchImpl?: typeof fetch) {
  return omsFetch("POST", `/api/ingest/order/${encodeURIComponent(orderId)}`, body, undefined, fetchImpl);
}
