import { defineConfig } from "@playwright/test";

// End-to-end tests against a running app + a real Supabase project (dev/staging only).
// Credentials come from E2E_* variables in .env.local (created by scripts/e2e-accounts.ts).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
