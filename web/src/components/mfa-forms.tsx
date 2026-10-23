"use client";

import { useState, useTransition } from "react";
import { startMfaEnrollment, verifyMfa } from "@/server/actions/auth";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function MfaVerifyForm({ factorId, from }: { factorId: string; from: "login" | "settings" }) {
  const { state, formAction, pending, err } = useFormAction(verifyMfa);
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-3">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="from" value={from} />
      <Field label="Authenticator code" name="code" error={err("code")} required>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}

export function MfaEnroll() {
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!enroll) {
    return (
      <div className="space-y-2">
        <Button
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await startMfaEnrollment();
              if (r.ok && r.data) setEnroll(r.data);
              else setError(r.ok ? "Could not start" : r.message);
            })
          }
        >
          {busy ? "Preparing…" : "Set up authenticator app"}
        </Button>
        {error ? <p className="text-sm text-red">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">Scan this QR code in Google Authenticator, Microsoft Authenticator or similar, then enter the code.</p>
      {/* Supabase returns the QR as an SVG data URI. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enroll.qr} alt="Authenticator QR code" width={180} height={180} className="rounded-lg bg-white p-2" />
      <p className="text-xs text-muted">
        Can’t scan? Enter this key manually: <code className="break-all">{enroll.secret}</code>
      </p>
      <MfaVerifyForm factorId={enroll.factorId} from="settings" />
    </div>
  );
}
