// OMS adapter contract tests with a fake fetch (no network). The live OMS is NOT exercised here.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// `server-only` throws outside a React Server Components bundle; neutralise it for unit tests.
const origLoad = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return origLoad.call(this, request, ...rest);
};

type Oms = typeof import("../../src/integrations/oms");
let oms: Oms;

before(async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value-not-a-key",
    SUPABASE_SECRET_KEY: "secret-test-value-not-a-real-key",
    RATE_LIMIT_SALT: "test-salt-0123456789",
    OMS_URL: "https://oms.example.test/",
    OMS_INGEST_TOKEN: "test-token-123",
    OMS_TIMEOUT_MS: "1000",
  });
  oms = await import("../../src/integrations/oms");
});

const input = {
  enqId: "SETMI-ENQ-0001",
  customer: { company: "Acme", contact: "Ravi", phone: "9876543210", whatsapp: "9876543210", email: "", gst: "" },
  items: [{ productId: "P1", qty: 2 }],
  note: "",
  quoteNo: "",
};

test("createOrder sends bearer auth, idempotency key and the legacy payload", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ ok: true, orderId: "ORD-0294" }), { status: 200 });
  }) as unknown as typeof fetch;
  const id = await oms.createOrder(input, "key-1", fake);
  assert.equal(id, "ORD-0294");
  assert.equal(seen!.url, "https://oms.example.test/api/ingest/order");
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer test-token-123");
  assert.equal(h["Idempotency-Key"], "key-1");
  assert.deepEqual(JSON.parse(String(seen!.init.body)).items, [{ productId: "P1", qty: 2 }]);
});

test("OMS rejection, bad JSON, bad order id and timeouts become typed errors", async () => {
  const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  await assert.rejects(oms.createOrder(input, "k", respond(JSON.stringify({ ok: false, msg: "Customer blocked" }))), (e: Error & { kind?: string }) => e.kind === "rejected" && /blocked/.test(e.message));
  await assert.rejects(oms.createOrder(input, "k", respond("<html>502</html>", 502)), (e: Error & { kind?: string }) => e.kind === "bad_response");
  await assert.rejects(oms.createOrder(input, "k", respond(JSON.stringify({ ok: true, orderId: "../../etc" }))), (e: Error & { kind?: string }) => e.kind === "bad_response");
  const hang = ((_u: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
  await assert.rejects(oms.createOrder(input, "k", hang), (e: Error & { kind?: string }) => e.kind === "timeout");
});

test("product list tolerates id/_id and drops incomplete products", async () => {
  const fake = (async () => new Response(JSON.stringify({ ok: true, products: [{ id: "1", name: "GX16" }, { _id: "2", title: "HDMI" }, { name: "no id" }] }))) as unknown as typeof fetch;
  const p = await oms.listProducts(fake);
  assert.deepEqual(p.map((x) => x.id), ["1", "2"]);
});
