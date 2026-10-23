"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { toast } from "@/components/toaster";

export type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

export function FormMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok && !state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        state.ok ? "bg-green/12 text-green-dk" : "bg-red/12 text-red",
      )}
    >
      {state.message}
    </p>
  );
}

/** Wrap an action so its success message reaches the app-wide toaster even if this form unmounts. */
function withToast(action: FormAction, onOk?: () => void): FormAction {
  return async (prev, fd) => {
    const r = await action(prev, fd);
    if (r?.ok) {
      if (r.message) toast(r.message);
      onOk?.();
    }
    return r;
  };
}

/**
 * Submit handler that dispatches a Server Action WITHOUT React's automatic form reset, so a
 * validation error never wipes what the user typed. Optional `before` can veto (e.g. confirm()).
 */
export function submitTo(dispatch: (fd: FormData) => void, before?: (fd: FormData) => boolean) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    if (before && !before(fd)) return;
    startTransition(() => dispatch(fd));
  };
}

/** For forms that render their own fields: returns state, the bound action, pending, and a field-error getter. */
export function useFormAction(action: FormAction, opts: { resetOnSuccess?: boolean; redirectTo?: string } = {}) {
  const router = useRouter();
  // Redirect from the action result itself: the form may unmount when its row disappears.
  const [wrapped] = useState(() => withToast(action, opts.redirectTo ? () => router.push(opts.redirectTo!) : undefined));
  const [state, formAction, pending] = useActionState(wrapped, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (opts.resetOnSuccess) formRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const err = (name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined);
  return { state, formAction, pending, err, formRef };
}

/**
 * One-click action (claim, approve, delete…) with optional confirmation and hidden inputs.
 * Server Actions passed in from Server Components keep their server-side authorization.
 */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  confirm,
  variant = "primary",
  size = "sm",
  className,
  children,
  inline = true,
}: {
  action: FormAction;
  fields: Record<string, string | number | null | undefined>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
  inline?: boolean;
}) {
  const [wrapped] = useState(() => withToast(action));
  const [state, formAction, pending] = useActionState(wrapped, null);
  return (
    <form
      action={formAction}
      className={cn(inline ? "inline-flex flex-col items-start gap-1" : "space-y-2", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v == null ? "" : String(v)} />
      ))}
      {children}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending ? pendingLabel ?? "Working…" : label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
