import { COMPANY } from "@/lib/domain/constants";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="logo text-3xl">
            SETMI <span className="in">INDIA</span>
          </div>
          <p className="text-xs text-muted">{COMPANY.tagline}</p>
          <p className="mt-1 text-sm font-semibold">Sales FMS · Enquiry to Order</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
