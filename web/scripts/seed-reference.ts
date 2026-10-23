#!/usr/bin/env tsx
/*
 * Loads reference data (36 states + ~19k pincode centroids) into Supabase using the server
 * secret key. Idempotent (upsert). Same data as supabase/seed/01_reference.sql, but sent in
 * batches over HTTPS so it works without a direct database connection.
 *   npx tsx --env-file=.env.local scripts/seed-reference.ts
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import { STATES } from "../src/lib/geo/states.generated";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. --env-file=.env.local).");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

function pincodes(): Array<{ pincode: string; lat: number; lng: number }> {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "PincodeGeo.js"), "utf8");
  const start = src.indexOf("{", src.indexOf("const PINCODE_LATLNG_"));
  const end = src.lastIndexOf("}");
  const obj = vm.runInNewContext(`(${src.slice(start, end + 1)})`) as Record<string, [number, number]>;
  return Object.entries(obj)
    .filter(([k, v]) => /^\d{6}$/.test(k) && Array.isArray(v))
    .map(([pincode, [lat, lng]]) => ({ pincode, lat, lng }));
}

async function main() {
  const { error: sErr } = await sb.from("india_states").upsert(
    STATES.map((s) => ({ name: s.name, iso: s.iso, zone: s.zone, lat: s.lat, lng: s.lng })),
    { onConflict: "name" },
  );
  if (sErr) throw sErr;
  const pins = pincodes();
  for (let i = 0; i < pins.length; i += 1000) {
    const { error } = await sb.from("pincode_geo").upsert(pins.slice(i, i + 1000), { onConflict: "pincode" });
    if (error) throw error;
  }
  const { count } = await sb.from("pincode_geo").select("pincode", { count: "exact", head: true });
  console.log(`states: ${STATES.length}, pincodes sent: ${pins.length}, pincodes in database: ${count}`);
}

main().catch((e) => {
  console.error("Seed failed:", (e as Error).message);
  process.exit(1);
});
