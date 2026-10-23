import "server-only";
import { z } from "zod";

// Server environment, validated once at first use. Never import this from a Client Component.
// Browser-safe values are the NEXT_PUBLIC_* ones only (Supabase URL + publishable key, which are
// safe to expose because every table is protected by RLS and every write by an authorizing RPC).
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_BASE_URL: z.url().optional(),
  // Salt for hashing IPs in rate-limit buckets (so raw IPs are never stored).
  RATE_LIMIT_SALT: z.string().min(16),
  CRON_SECRET: z.string().min(24).optional(),
  OMS_URL: z.url().optional(),
  OMS_INGEST_TOKEN: z.string().min(8).optional(),
  OMS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  META_SHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  MAP_TILE_URL: z.string().default("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
  // When "true", admins must enrol a TOTP authenticator before using admin features.
  REQUIRE_ADMIN_MFA: z.enum(["true", "false"]).default("false"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    // Names only — never echo values.
    throw new Error(`Invalid or missing environment variables: ${names}. See web/.env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function isConfigured(name: "oms" | "smtp" | "metaSheet"): boolean {
  const e = env();
  if (name === "oms") return Boolean(e.OMS_URL && e.OMS_INGEST_TOKEN);
  if (name === "smtp") return Boolean(e.SMTP_HOST && e.SMTP_FROM);
  return Boolean(e.META_SHEET_ID && e.GOOGLE_SERVICE_ACCOUNT_EMAIL && e.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}
