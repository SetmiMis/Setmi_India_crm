"use client";

import { useEffect, useState } from "react";

// App-wide success notices. Lives in the layout, so a confirmation stays visible even when the
// row that triggered it disappears (approve, reject, claim, accept transfer…).
type Toast = { id: number; message: string };

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent<string>("crm-toast", { detail: message }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const id = Date.now() + Math.random();
      setItems((cur) => [...cur.slice(-2), { id, message: (e as CustomEvent<string>).detail }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 5000);
    };
    window.addEventListener("crm-toast", onToast);
    return () => window.removeEventListener("crm-toast", onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} role="status" data-toast className="pointer-events-auto rounded-xl border border-green/40 bg-[var(--panel-solid)] px-4 py-2.5 text-sm font-medium text-green-dk shadow-lg">
          {t.message}
        </div>
      ))}
    </div>
  );
}
