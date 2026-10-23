import "server-only";
import { userClient } from "@/lib/supabase/server";
import { fromDbError, type Failure } from "@/lib/errors";

/** Call a database RPC as the signed-in user and normalise the result. */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | Failure> {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fromDbError(error);
  return { ok: true, data: data as T };
}

/** Read helper for Server Components: throws on unexpected errors so error.tsx renders. */
export async function readRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const r = fromDbError(error);
    throw new Error(r.ok ? "Request failed" : r.message);
  }
  return data as T;
}
