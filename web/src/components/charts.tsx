import Link from "next/link";
import { num } from "@/lib/cn";

// Single-series charts rendered as HTML (no client JS, CSP-friendly, readable as a table).
// Brand hues failed the colour-vision check as a categorical set, so every chart here is
// one hue (cyan) with direct value labels; identity is carried by text, never colour alone.

type Item = { label: string; value: number; href?: string; hint?: string };

export function BarList({ items, format = num, empty = "No data for these filters.", max: maxItems = 12, label }: {
  items: Item[];
  format?: (v: number) => string;
  empty?: string;
  max?: number;
  label: string;
}) {
  const shown = items.slice(0, maxItems);
  const rest = items.slice(maxItems).reduce((s, i) => s + i.value, 0);
  const all = rest > 0 ? [...shown, { label: `Other (${items.length - maxItems})`, value: rest }] : shown;
  const top = Math.max(1, ...all.map((i) => i.value));
  if (all.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {all.map((i) => {
        const pct = Math.max(1.5, (i.value / top) * 100);
        const inner = (
          <div className="group grid grid-cols-[minmax(84px,34%)_1fr] items-center gap-2 text-[13px]" title={`${i.label}: ${format(i.value)}${i.hint ? ` · ${i.hint}` : ""}`}>
            <span className="truncate text-muted">{i.label}</span>
            <span className="flex items-center gap-2">
              <span className="h-[14px] rounded-r-[4px] bg-cyan-dk transition-[filter] group-hover:brightness-110" style={{ width: `${pct}%` }} />
              <span className="shrink-0 font-semibold tabular-nums">{format(i.value)}</span>
            </span>
          </div>
        );
        return <li key={i.label}>{i.href ? <Link href={i.href} className="block rounded hover:bg-chip">{inner}</Link> : inner}</li>;
      })}
    </ul>
  );
}

/** Vertical columns for change over time (e.g. last 6 months). */
export function ColumnChart({ items, label }: { items: Item[]; label: string }) {
  const top = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">No data for these filters.</p>;
  return (
    <div role="img" aria-label={`${label}: ${items.map((i) => `${i.label} ${i.value}`).join(", ")}`} className="flex h-44 items-end gap-2 border-b border-line px-1">
      {items.map((i) => (
        <div key={i.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${i.label}: ${num(i.value)}`}>
          <span className="text-[11.5px] font-semibold tabular-nums">{num(i.value)}</span>
          <span className="w-full max-w-12 rounded-t-[4px] bg-cyan-dk" style={{ height: `${Math.max(2, (i.value / top) * 82)}%` }} />
          <span className="text-[11px] text-muted">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Stage funnel (counts per stage with share of total). */
export function Funnel({ stages, total }: { stages: Array<{ stage: string; count: number; href: string }>; total: number }) {
  return (
    <BarList
      label="Enquiries by stage"
      items={stages.map((s) => ({ label: s.stage, value: s.count, href: s.href, hint: total ? `${Math.round((s.count * 100) / total)}% of all` : undefined }))}
    />
  );
}
