import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="logo text-3xl">SETMI <span className="in">INDIA</span></div>
      <h1 className="mt-4 font-display text-xl font-bold">Not found</h1>
      <p className="mt-1 text-sm text-muted">That page or record does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-cyan-dk underline">Go to the dashboard</Link>
    </main>
  );
}
