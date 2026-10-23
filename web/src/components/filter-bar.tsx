import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";

/** Filters as a plain GET form: shareable URLs, works without JS, applied server-side. */
export function FilterBar({ action, children, resetHref }: { action: string; children: ReactNode; resetHref?: string }) {
  return (
    <form method="get" action={action} className="card mb-4 flex flex-wrap items-end gap-2.5 p-3" role="search">
      {children}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary", "sm")}>
          Apply
        </button>
        <Link href={resetHref ?? action} className={buttonClass("ghost", "sm")}>
          Reset
        </Link>
      </div>
    </form>
  );
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className ?? "min-w-[130px] flex-1 sm:flex-none"}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function FilterSelect({
  name,
  value,
  options,
  all = "All",
}: {
  name: string;
  value?: string;
  options: ReadonlyArray<string | { value: string; label: string }>;
  all?: string;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className="input">
      <option value="">{all}</option>
      {options.map((o) => {
        const v = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        );
      })}
    </select>
  );
}

export function sp(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= 100 ? s : undefined;
}
