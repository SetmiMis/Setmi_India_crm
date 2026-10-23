import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { PageHeader, Card, EmptyState } from "@/components/ui/layout";
import { FilterBar, FilterField, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { CustomerForm } from "./customer-form";

export const metadata: Metadata = { title: "Customers" };

type Customer = {
  id: string; cust_code: string; name: string; company: string; phone: string; email: string; gst: string; pincode: string;
  district: string; state: string; city: string; source: string; notes: string; enquiries: number; total: number;
};
const PAGE = 30;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const page = pageFromParams(s.page);
  const q = sp(s.q);
  const rows = await readRpc<Customer[]>("list_customers", { p_q: q ?? null, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const total = rows[0]?.total ?? 0;
  return (
    <>
      <PageHeader title="Customers" subtitle={user.isAdmin ? "Customer master — one record per phone number" : "Customers of your leads"} />
      <details className="card mb-4 p-4">
        <summary className="cursor-pointer font-semibold">+ Add customer</summary>
        <div className="mt-3"><CustomerForm /></div>
      </details>
      <FilterBar action="/customers">
        <FilterField label="Search" className="min-w-[220px] flex-1"><Input name="q" defaultValue={q} placeholder="Name, company, phone, city…" /></FilterField>
      </FilterBar>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No customers found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Customer</th><th>Phone</th><th>Location</th><th>GSTIN</th><th className="text-right">Enquiries</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.cust_code}{c.company ? ` · ${c.company}` : ""}</div></td>
                    <td className="whitespace-nowrap"><a className="text-cyan-dk hover:underline" href={`tel:${c.phone}`}>{c.phone}</a><div className="text-xs text-muted">{c.email}</div></td>
                    <td>{[c.city, c.district, c.state].filter(Boolean).join(", ")}</td>
                    <td className="text-xs">{c.gst}</td>
                    <td className="text-right">
                      <Link className="text-cyan-dk hover:underline" href={`/pipeline?q=${encodeURIComponent(c.phone)}`}>{c.enquiries}</Link>
                    </td>
                    <td>
                      <details>
                        <summary className="cursor-pointer text-sm text-cyan-dk">Edit</summary>
                        <div className="mt-2 w-[min(640px,80vw)]">
                          <CustomerForm customer={c} />
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3"><Pagination basePath="/customers" params={{ q }} page={page} pageSize={PAGE} total={total} /></div>
      </Card>
    </>
  );
}
