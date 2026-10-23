import Link from "next/link";
import { buttonClass } from "./button";

/** Server-side pagination links that preserve the current filters (search params). */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span>
        {from}–{to} of {total.toLocaleString("en-IN")}
      </span>
      <span className="flex gap-1.5">
        {page > 1 ? (
          <Link className={buttonClass("secondary", "sm")} href={href(page - 1)} rel="prev">
            ← Prev
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "opacity-40")} aria-disabled>
            ← Prev
          </span>
        )}
        <span className="px-2 py-1.5">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link className={buttonClass("secondary", "sm")} href={href(page + 1)} rel="next">
            Next →
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "opacity-40")} aria-disabled>
            Next →
          </span>
        )}
      </span>
    </nav>
  );
}

export function pageFromParams(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
