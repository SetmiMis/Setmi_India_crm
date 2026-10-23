// Next's standalone output does not include static assets; copy them next to server.js
// so `node .next/standalone/server.js` serves everything (docs/DEPLOYMENT_HOSTINGER.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sa = path.join(root, ".next", "standalone");
if (!fs.existsSync(sa)) {
  console.error("No .next/standalone — run next build first.");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next", "static"), path.join(sa, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(sa, "public"), { recursive: true });
console.log("Copied .next/static and public into .next/standalone");
