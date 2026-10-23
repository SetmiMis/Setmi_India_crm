"use client";

import { useMemo, useState, useTransition } from "react";
import { bulkImport, importMetaFile, importMetaSheetNow, type ImportSummary } from "@/server/actions/imports";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { applyBulkMapping, guessBulkMapping, mapMetaRows, type BulkMapping } from "@/lib/domain/imports";
import { parseSpreadsheet, type ParsedSheet } from "@/lib/spreadsheet-client";
import type { ActionResult } from "@/lib/errors";

const FIELDS: Array<[keyof BulkMapping, string, boolean]> = [
  ["name", "Customer name", true],
  ["phone", "Phone", true],
  ["company", "Company", false],
  ["requirement", "Requirement / product", false],
  ["quantity", "Quantity", false],
  ["source", "Source", false],
  ["priority", "Priority", false],
  ["remark", "Remark", false],
];

export function BulkImport({ team }: { team: Array<{ id: string; name: string }> }) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [tab, setTab] = useState(0);
  const [mapping, setMapping] = useState<BulkMapping>({});
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { state, formAction, pending } = useFormAction(bulkImport);
  const sheet = sheets[tab];
  const mapped = useMemo(() => (sheet ? applyBulkMapping(sheet.rows, mapping) : []), [sheet, mapping]);

  const onFile = async (f: File | undefined) => {
    setError(null);
    setSheets([]);
    if (!f) return;
    try {
      const s = await parseSpreadsheet(f);
      if (!s.length) throw new Error("No rows found in the file.");
      setSheets(s);
      setTab(0);
      setMapping(guessBulkMapping(s[0].headers));
      setFileName(f.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const summary = state?.ok ? (state.data as ImportSummary | undefined) : undefined;

  return (
    <div className="space-y-4">
      <Field label="File (.csv or .xlsx, max 5 MB / 2000 rows)" name="bulkfile">
        <Input id="bulkfile" type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {sheet ? (
        <form onSubmit={submitTo(formAction)} className="space-y-4">
          <input type="hidden" name="rows" value={JSON.stringify(mapped.slice(0, 2000))} />
          <input type="hidden" name="file_name" value={fileName} />
          {sheets.length > 1 ? (
            <Field label="Sheet" name="tab">
              <Select id="tab" options={sheets.map((s, i) => ({ value: String(i), label: `${s.tab} (${s.rows.length} rows)` }))} value={String(tab)}
                onChange={(e) => { const i = Number(e.target.value); setTab(i); setMapping(guessBulkMapping(sheets[i].headers)); }} />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {FIELDS.map(([key, label, req]) => (
              <Field key={key} label={label} name={`map-${key}`} required={req}>
                <Select id={`map-${key}`} options={sheet.headers} placeholder="— not in file —" value={mapping[key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || undefined })} />
              </Field>
            ))}
            <Field label="Assign all to (optional)" name="owner_id">
              <Select name="owner_id" options={team.map((t) => ({ value: t.id, label: t.name }))} placeholder="Unassigned" />
            </Field>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="data">
              <thead><tr><th>#</th>{FIELDS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
              <tbody>
                {mapped.slice(0, 8).map((r, i) => (
                  <tr key={i}><td>{i + 1}</td>{FIELDS.map(([k]) => <td key={k} className="max-w-[200px] truncate">{r[k]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">Preview of the first 8 of {mapped.length} rows. Rows need a name or a 10-digit phone; exact duplicates inside the file are skipped. Text that looks like a spreadsheet formula is neutralised.</p>
          {mapped.length > 2000 ? <Notice tone="warn">Only the first 2000 rows will be imported. Split the file for the rest.</Notice> : null}
          <Button type="submit" disabled={pending || (!mapping.name && !mapping.phone)}>{pending ? "Importing…" : `Import ${Math.min(mapped.length, 2000)} rows to Pending Approvals`}</Button>
          <FormMessage state={state} />
          {summary && summary.errors.length ? (
            <details className="text-sm"><summary className="cursor-pointer">Row problems ({summary.errors.length})</summary>
              <ul className="mt-1 list-disc pl-5">{summary.errors.slice(0, 100).map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>
            </details>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function MetaImport({ sheetConfigured }: { sheetConfigured: boolean }) {
  const [rows, setRows] = useState<ReturnType<typeof mapMetaRows>>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { state, formAction, pending } = useFormAction(importMetaFile);
  const [sheetResult, setSheetResult] = useState<ActionResult | null>(null);
  const [running, start] = useTransition();

  const onFile = async (f: File | undefined) => {
    setError(null);
    setRows([]);
    if (!f) return;
    try {
      const sheets = await parseSpreadsheet(f);
      const leads = sheets.flatMap((s) => mapMetaRows(s.headers, s.rows, s.tab));
      if (!leads.length) throw new Error("No Meta leads found (need a name or phone column).");
      setRows(leads);
      setFileName(f.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Leads are de-duplicated by their Meta lead id, so re-importing the same export is safe. Where they land (Pending Approvals or straight to
        Available Leads) is set in Admin Settings.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!sheetConfigured || running}
          onClick={() => start(async () => setSheetResult(await importMetaSheetNow()))}>
          {running ? "Importing…" : "Import from the Meta leads Google Sheet now"}
        </Button>
        {!sheetConfigured ? <span className="text-xs text-muted">Sheet import needs META_SHEET_ID and a Google service account (see docs).</span> : null}
        <FormMessage state={sheetResult} />
      </div>
      <Field label="…or upload a Meta lead export (.csv / .xlsx)" name="metafile">
        <Input id="metafile" type="file" accept=".csv,.xlsx" onChange={(e) => onFile(e.target.files?.[0])} />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {rows.length ? (
        <form onSubmit={submitTo(formAction)} className="space-y-2">
          <input type="hidden" name="rows" value={JSON.stringify(rows.slice(0, 5000))} />
          <input type="hidden" name="file_name" value={fileName} />
          <p className="text-sm">{rows.length} lead(s) found. First: <b>{rows[0].name || rows[0].phone}</b> — {rows[0].requirement || "no product"}.</p>
          <Button type="submit" disabled={pending}>{pending ? "Importing…" : `Import ${rows.length} Meta lead(s)`}</Button>
          <FormMessage state={state} />
        </form>
      ) : null}
    </div>
  );
}
