// Captures UI screenshots of key pages with the E2E accounts (dev aid). Usage: node scripts/screenshots.mjs <out-dir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.startsWith("E2E_")).map(l=>l.split(/=(.*)/s).slice(0,2)));
const out = process.argv[2];
const b = await chromium.launch({ channel: "msedge" });
async function shoot(who, pages, viewport) {
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3000/login");
  await p.getByLabel("Username or email").fill(env[`E2E_${who}_LOGIN`]);
  await p.getByLabel("Password").fill(env[`E2E_${who}_PASSWORD`]);
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL("**/dashboard");
  for (const [name, url] of pages) {
    await p.goto("http://localhost:3000" + url); await p.waitForLoadState("networkidle"); await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${who}-${viewport.width}-${name}.png`, fullPage: false });
  }
  await ctx.close();
}
await shoot("ADMIN", [["dashboard","/dashboard"],["pipeline","/pipeline"],["approvals","/approvals"],["map","/map"],["admin","/admin"]], { width: 1400, height: 900 });

await shoot("REP1", [["dashboard","/dashboard"],["followups","/follow-ups"]], { width: 390, height: 844 });
await b.close();
console.log("done");
