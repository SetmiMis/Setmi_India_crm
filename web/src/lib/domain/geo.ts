import { STATE_ALIASES, STATES, type Zone } from "@/lib/geo/states.generated";

export type { Zone };
export const ZONES: readonly Zone[] = ["North", "South", "East", "West", "Central", "Northeast", "Islands"];

const byName = new Map(STATES.map((s) => [s.name, s]));

function clean(raw: string): string {
  return raw.toUpperCase().replace(/\(.*?\)/g, "").replace(/[^A-Z& ]/g, "").replace(/\s+/g, " ").trim();
}

/** Legacy normalizeState_: alias lookup after stripping punctuation and "(INDIA)"-style noise. */
export function normalizeState(raw: string | null | undefined): { iso: string; name: string } | null {
  if (!raw) return null;
  const hit = STATE_ALIASES[clean(raw)];
  return hit ? { iso: hit[0], name: hit[1] } : null;
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Legacy fuzzyNormalizeState_: exact alias first, then ~1 typo per 5 letters. */
export function fuzzyNormalizeState(raw: string | null | undefined): { iso: string; name: string } | null {
  const exact = normalizeState(raw);
  if (exact || !raw) return exact;
  const c = clean(raw);
  if (c.length < 4) return null;
  let best: (typeof STATES)[number] | null = null;
  let bestDist = Infinity;
  for (const s of STATES) {
    const d = levenshtein(c, s.name.toUpperCase().replace(/[^A-Z& ]/g, ""));
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best) return null;
  const allowed = Math.max(1, Math.floor(best.name.length * 0.2));
  return bestDist <= allowed ? { iso: best.iso, name: best.name } : null;
}

export function zoneOf(stateName: string | null | undefined): Zone | "Unclassified" {
  const s = stateName ? byName.get(stateName) ?? byName.get(normalizeState(stateName)?.name ?? "") : undefined;
  return s?.zone ?? "Unclassified";
}

export function stateCentroid(stateName: string): [number, number] | null {
  const s = byName.get(stateName);
  return s && s.lat != null && s.lng != null ? [s.lat, s.lng] : null;
}
