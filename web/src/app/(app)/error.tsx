"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="font-display text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">The page could not load. Your data is safe — try again, or reload if it keeps happening.</p>
      {error.digest ? <p className="mt-1 text-xs text-muted">Reference: {error.digest}</p> : null}
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
