// Error contract shared by Server Actions and Route Handlers.
// Database RPCs raise with a machine-readable `hint` (see supabase/migrations/*_rpc_*.sql).

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string; code: ErrorCode; fieldErrors?: Record<string, string> };

export type Failure = Extract<ActionResult<never>, { ok: false }>;

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "already_reviewed"
  | "rate_limited"
  | "unavailable"
  | "internal";

const KNOWN: ReadonlySet<string> = new Set([
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid",
  "conflict",
  "already_reviewed",
]);

type PgLikeError = { message?: string; hint?: string | null; code?: string; details?: string | null };

/** Turn a Supabase/PostgREST error into a safe, user-facing result. Unknown errors are not echoed. */
export function fromDbError(err: PgLikeError | null | undefined): Failure {
  if (!err) return { ok: false, code: "internal", message: "Something went wrong. Please try again." };
  if (err.hint && KNOWN.has(err.hint)) {
    return { ok: false, code: err.hint as ErrorCode, message: err.message ?? "Request failed" };
  }
  if (err.code === "42501") return { ok: false, code: "forbidden", message: "You do not have permission to do that." };
  if (err.code === "23505") return { ok: false, code: "conflict", message: "That record already exists." };
  if (err.code === "PGRST301" || err.code === "401") {
    return { ok: false, code: "unauthenticated", message: "Your session expired. Please sign in again." };
  }
  logServerError("db", err);
  return { ok: false, code: "internal", message: "Something went wrong. Please try again." };
}

export function invalid(message: string, fieldErrors?: Record<string, string>): Failure {
  return { ok: false, code: "invalid", message, fieldErrors };
}

// Structured, redacted server log line (no request bodies, tokens, phones or emails).
const REDACT = [/\b\d{10,}\b/g, /[\w.+-]+@[\w-]+\.[\w.]+/g, /(eyJ[\w-]+\.[\w-]+\.[\w-]+)/g, /(sb_secret_[\w-]+)/g];

export function redact(s: string): string {
  return REDACT.reduce((acc, re) => acc.replace(re, "[redacted]"), s);
}

export function logServerError(scope: string, err: unknown): void {
  const e = err as { message?: string; code?: string; hint?: string };
  const line = {
    level: "error",
    scope,
    at: new Date().toISOString(),
    code: e?.code ?? null,
    hint: e?.hint ?? null,
    message: redact(String(e?.message ?? err)).slice(0, 500),
  };
  console.error(JSON.stringify(line));
}
