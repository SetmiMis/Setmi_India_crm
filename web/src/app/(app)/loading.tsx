export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-chip" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}
      </div>
      <div className="card h-72 animate-pulse" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
