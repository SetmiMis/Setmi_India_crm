"use client";

import { useEffect, useState, useTransition } from "react";
import { fetchOmsProducts, getOmsStatus, omsAction, recordOmsOrder } from "@/server/actions/oms";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

type Product = { id: string; name: string; unit?: string };
type Item = { productId: string; qty: string; remarks: string };

export function OmsPanel({ id, configured, linkedOrder }: { id: string; configured: boolean; linkedOrder: string | null }) {
  if (!configured) {
    return <p className="text-sm text-muted">The OMS connection is not configured on this server (OMS_URL / OMS_INGEST_TOKEN). Ask an admin.</p>;
  }
  return linkedOrder ? <OrderStatus id={id} orderId={linkedOrder} /> : <OrderForm id={id} />;
}

function OrderForm({ id }: { id: string }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([{ productId: "", qty: "", remarks: "" }]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const { state, formAction, pending, err } = useFormAction(recordOmsOrder);
  const [loading, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await fetchOmsProducts();
      if (r.ok) setProducts(r.products);
      else setLoadError(r.message);
    });

  if (!products) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">Recording the order in OMS also marks this enquiry Won (no invoice needed yet).</p>
        <Button variant="secondary" onClick={load} disabled={loading}>{loading ? "Loading products…" : "Start OMS order"}</Button>
        {loadError ? <p className="text-sm text-red">{loadError}</p> : null}
      </div>
    );
  }
  const valid = items.filter((i) => i.productId && Number(i.qty) > 0);
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="request_key" value={requestKey} />
      <input type="hidden" name="items" value={JSON.stringify(valid.map((i) => ({ productId: i.productId, qty: Number(i.qty), remarks: i.remarks })))} />
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_80px] gap-2">
          <Select
            aria-label={`Product ${idx + 1}`}
            options={products.map((p) => ({ value: p.id, label: p.unit ? `${p.name} (${p.unit})` : p.name }))}
            placeholder="Product…"
            value={it.productId}
            onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, productId: e.target.value } : x)))}
          />
          <Input aria-label={`Quantity ${idx + 1}`} inputMode="decimal" placeholder="Qty" value={it.qty}
            onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
          <Input aria-label={`Remarks ${idx + 1}`} className="col-span-2" placeholder="Remarks (optional)" value={it.remarks} maxLength={300}
            onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, remarks: e.target.value } : x)))} />
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setItems([...items, { productId: "", qty: "", remarks: "" }])}>+ Add product</Button>
        {items.length > 1 ? <Button variant="ghost" size="sm" onClick={() => setItems(items.slice(0, -1))}>Remove last</Button> : null}
      </div>
      <Field label="Note for accounts" name="note"><Input name="note" maxLength={1000} /></Field>
      {err("items") ? <p className="text-sm text-red">{err("items")}</p> : null}
      <Button type="submit" variant="success" disabled={pending || valid.length === 0}>{pending ? "Recording…" : "Record order"}</Button>
      <FormMessage state={state} />
    </form>
  );
}

function OrderStatus({ id, orderId }: { id: string; orderId: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getOmsStatus>> | null>(null);
  const { state: piState, formAction: piAction, pending: piPending } = useFormAction(omsAction);
  const { state: payState, formAction: payAction, pending: payPending, err: payErr, formRef: payRef } = useFormAction(omsAction, { resetOnSuccess: true });
  useEffect(() => {
    getOmsStatus(id).then(setInfo);
  }, [id, piState, payState]);
  return (
    <div className="space-y-3 text-sm">
      <p>Order <b>{orderId}</b>{info && "status" in info && info.status ? <> · status <b>{info.status}</b></> : null}</p>
      {info && "error" in info && info.error ? <p className="text-red">{info.error}</p> : null}
      {info && "piUrl" in info && info.piUrl ? <a className="text-cyan-dk underline" href={info.piUrl} target="_blank" rel="noopener noreferrer">Download PI</a> : null}
      <form onSubmit={submitTo(piAction)} className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value="piSent" />
        <Button type="submit" size="sm" variant="secondary" disabled={piPending}>Mark PI sent to customer</Button>
        <FormMessage state={piState} />
      </form>
      <form onSubmit={submitTo(payAction)} ref={payRef} className="grid grid-cols-2 gap-2">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value="payment" />
        <Field label="Amount received (₹)" name="amount" error={payErr("amount")}><Input name="amount" inputMode="decimal" required /></Field>
        <Field label="Reference / UTR" name="ref"><Input name="ref" maxLength={100} /></Field>
        <Field label="Proof link (https)" name="proofUrl" error={payErr("proofUrl")} className="col-span-2"><Input name="proofUrl" type="url" maxLength={500} /></Field>
        <div className="col-span-2 flex items-center gap-2">
          <Button type="submit" size="sm" disabled={payPending}>Record payment</Button>
          <FormMessage state={payState} />
        </div>
      </form>
    </div>
  );
}
