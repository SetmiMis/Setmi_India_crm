// End-to-end business flows on a real database with synthetic "E2E TEST" records.
//   npx tsx scripts/e2e-accounts.ts   (once, with --env-file=.env.local)
//   npm run dev  (other terminal)  →  npx playwright test   (loads .env.local itself)
import { test, expect, type Page, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^(E2E_[A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const cred = (who: "ADMIN" | "REP1" | "REP2") => ({ login: process.env[`E2E_${who}_LOGIN`]!, password: process.env[`E2E_${who}_PASSWORD`]! });

const run = Date.now().toString().slice(-6);
const phoneA = `98${run}11`; // 10 digits
const phoneB = `97${run}22`;
const nameA = `E2E TEST Buyer A ${run}`;
const nameB = `E2E TEST Buyer B ${run}`;

async function signIn(browser: Browser, who: "ADMIN" | "REP1" | "REP2"): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  const c = cred(who);
  await page.getByLabel("Username or email").fill(c.login);
  await page.getByLabel("Password").fill(c.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

async function newEnquiry(page: Page, name: string, phone: string, leadByLabel: string | null) {
  await page.goto("/new-enquiry");
  await page.getByLabel("Phone").fill(phone);
  await page.getByLabel("Customer name").fill(name);
  await page.getByLabel("Company").fill("E2E Test Pvt Ltd");
  await page.getByLabel("Pincode").fill("110001");
  await page.getByLabel("Requirement").fill("GX16 circular connector 4 pin");
  await page.getByLabel("Qty (metres/units)").fill("600");
  await page.getByLabel("Buyer timeline").selectOption("Immediate");
  await page.getByLabel("Lead By").selectOption(leadByLabel === null ? { value: "" } : { label: leadByLabel });
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/Saved to Pending Approvals/).first()).toBeVisible();
}

async function approve(admin: Page, name: string) {
  await admin.goto(`/approvals?q=${encodeURIComponent(name)}`);
  const item = admin.locator("li", { hasText: name }).first();
  await item.getByRole("button", { name: "Approve" }).click();
  await expect(admin.locator("[data-toast]").filter({ hasText: "Approved as SETMI-ENQ-" })).toBeVisible();
}

test.describe.serial("SETMI CRM end-to-end", () => {
  let admin: Page, rep1: Page, rep2: Page;
  let enquiryAUrl = "";

  test.beforeAll(async ({ browser }) => {
    admin = await signIn(browser, "ADMIN");
    rep1 = await signIn(browser, "REP1");
    rep2 = await signIn(browser, "REP2");
  });

  test("signed-out users are sent to login; wrong password is rejected generically", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Username or email").fill(cred("REP1").login);
    await page.getByLabel("Password").fill("definitely-wrong-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong username/email or password.")).toBeVisible();
  });

  test("rep submits a New Enquiry → it waits in Pending Approvals", async () => {
    await newEnquiry(rep1, nameA, phoneA, null);
    await rep1.goto("/approvals");
    await expect(rep1.getByText(nameA)).toBeVisible();
    await expect(rep1.getByRole("button", { name: "Approve" })).toHaveCount(0); // reps cannot approve
  });

  test("admin approves without owner → lead appears on Available Leads", async () => {
    await approve(admin, nameA);
    await rep1.goto(`/leads?q=${encodeURIComponent(nameA)}`);
    await expect(rep1.getByText(nameA)).toBeVisible();
  });

  test("rep claims, logs a call, and the lead becomes Follow-up with a next date", async () => {
    await rep1.goto(`/leads?q=${encodeURIComponent(nameA)}`);
    const item = rep1.locator("li", { hasText: nameA }).first();
    await item.getByLabel("Priority after the call").selectOption("Hot");
    await item.getByRole("button", { name: "Claim" }).click();
    await rep1.waitForURL("**/enquiries/**");
    enquiryAUrl = rep1.url().split("#")[0];
    await rep1.getByLabel("Call status").selectOption("Connected");
    await rep1.getByLabel("Customer interest").selectOption("Interested");
    await rep1.getByLabel("Remarks").fill("E2E: asked for quotation");
    await rep1.getByRole("button", { name: "Log call" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Call 1 logged" }).first()).toBeVisible();
    await rep1.reload();
    await expect(rep1.getByText("Follow-up", { exact: true }).first()).toBeVisible();
    await expect(rep1.getByTitle("Lead grade (Qty × Timeline)")).toHaveText("Grade A");
    await expect(rep1.getByText(/Delhi/).first()).toBeVisible(); // state filled from the pincode on the server
  });

  test("pipeline: Quoted → Won (invoice required) → Dispatched → Closed", async () => {
    await rep1.goto(enquiryAUrl);
    const stage = rep1.getByLabel(/^From .* to$/);
    await stage.selectOption("Quoted");
    await rep1.getByLabel("Quote no.").fill(`E2E-Q-${run}`);
    await rep1.getByLabel("Quote amount (₹)").fill("25000");
    await rep1.getByRole("button", { name: "Move to Quoted" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Moved to Quoted" })).toBeVisible();

    await rep1.reload();
    await rep1.getByLabel(/^From .* to$/).selectOption("Won");
    await rep1.getByLabel("Invoice no.").fill(`E2E-INV-${run}`);
    await rep1.getByLabel("Order value (₹)").fill("24000");
    await rep1.getByRole("button", { name: "Move to Won" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Moved to Won" })).toBeVisible();

    await rep1.reload();
    await rep1.getByLabel(/^From .* to$/).selectOption("Dispatched");
    await rep1.getByLabel("Courier / LR / details").fill("E2E courier 123");
    await rep1.getByLabel("Weight (kg)").fill("2.5");
    await rep1.getByRole("button", { name: "Move to Dispatched" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Moved to Dispatched" })).toBeVisible();

    await rep1.reload();
    await rep1.getByLabel(/^From .* to$/).selectOption("Closed");
    await rep1.getByLabel("Feedback rating").selectOption("5");
    await rep1.getByRole("button", { name: "Move to Closed" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Moved to Closed" })).toBeVisible();
  });

  test("another rep cannot open this enquiry by URL", async () => {
    await rep2.goto(enquiryAUrl);
    await expect(rep2.getByRole("heading", { name: "Not found" })).toBeVisible();
  });

  test("transfer: rep1 proposes, rep2 accepts, ownership moves", async () => {
    await newEnquiry(rep1, nameB, phoneB, "E2E Rep One");
    await approve(admin, nameB);
    await rep1.goto(`/pipeline?q=${encodeURIComponent(nameB)}`);
    await rep1.getByRole("link", { name: /SETMI-ENQ-/ }).first().click();
    await rep1.waitForURL("**/enquiries/**");
    const urlB = rep1.url();
    await rep1.getByLabel("Transfer to").selectOption({ label: "E2E Rep Two" });
    await rep1.getByRole("button", { name: "Propose transfer" }).click();
    await expect(rep1.locator("[data-toast]").filter({ hasText: "Transfer proposed" })).toBeVisible();

    await rep2.goto("/pipeline");
    const incoming = rep2.locator("li", { hasText: nameB });
    await incoming.getByRole("button", { name: "Accept" }).click();
    await expect(rep2.locator("[data-toast]").filter({ hasText: "Transfer accepted" })).toBeVisible();
    await rep2.goto(urlB);
    await expect(rep2.getByRole("heading", { name: nameB })).toBeVisible();
    await rep1.goto(urlB);
    await expect(rep1.getByRole("heading", { name: "Not found" })).toBeVisible();
  });

  test("public enquiry form lands in Pending; admin rejects with a reason", async ({ page }) => {
    const pub = `E2E TEST Public ${run}`;
    await page.goto("/enquiry");
    await page.getByLabel("Your name").fill(pub);
    await page.getByLabel("Mobile number").fill(`96${run}33`);
    await page.getByLabel("What do you need?").fill("HDMI cables, 50 pieces");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.getByText(/Thank you/).first()).toBeVisible();

    await admin.goto(`/approvals?q=${encodeURIComponent(pub)}`);
    const item = admin.locator("li", { hasText: pub }).first();
    await expect(item.getByText("Public form")).toBeVisible();
    await item.getByLabel("Reject reason").fill("E2E test record");
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(admin.locator("[data-toast]").filter({ hasText: "Rejected" })).toBeVisible();
  });

  test("admin pages load with data; reps are kept out of admin pages", async () => {
    for (const [path_, heading] of [
      ["/dashboard", /Namaste/], ["/reports", "Reports"], ["/team-performance", "Team Performance"],
      ["/users", "Users & Team"], ["/admin", "Admin Settings"], ["/map", "MAP Analytics"],
      ["/analysis", "Data Analysis"], ["/calls", "Call Management"], ["/customers", "Customers"], ["/follow-ups", "Follow-ups"],
    ] as const) {
      await admin.goto(path_);
      await expect(admin.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await expect(admin.getByText("E2E Rep One").first()).toBeVisible();
    await rep1.goto("/reports");
    await expect(rep1).toHaveURL(/\/dashboard\?denied=1/);
    const csv = await rep1.request.get("/api/export/enquiries");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).not.toContain(nameB); // nameB now belongs to rep2
  });

  test("security headers are present", async ({ request }) => {
    const r = await request.get("/login");
    const h = r.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", db: "ok" });
  });
});
