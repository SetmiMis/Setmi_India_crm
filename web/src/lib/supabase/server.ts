import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Supabase client acting AS THE SIGNED-IN USER (publishable key + session cookie).
 * Every query is filtered by RLS and every RPC authorizes the user itself.
 */
export async function userClient() {
  const store = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component render: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * Privileged client (secret key, bypasses RLS). Only for server-only operations that have
 * already been authorized in code: public intake, metrics, share links, auth admin, jobs.
 */
export function serviceClient() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
