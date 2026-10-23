import type { Metadata } from "next";
import { COMPANY } from "@/lib/domain/constants";
import { PublicEnquiryForm } from "./public-form";

export const metadata: Metadata = { title: "Send an enquiry", robots: { index: false, follow: false } };

export default function PublicEnquiryPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-5 text-center">
        <div className="logo text-3xl">SETMI <span className="in">INDIA</span></div>
        <p className="text-xs text-muted">{COMPANY.tagline}</p>
        <h1 className="mt-3 font-display text-xl font-bold">Send us your requirement</h1>
        <p className="text-sm text-muted">Connectors, cables and switches — we will call you back.</p>
      </div>
      <div className="card p-5">
        <PublicEnquiryForm />
      </div>
      <p className="mt-4 text-center text-xs text-muted">We use your details only to respond to this enquiry.</p>
    </main>
  );
}
