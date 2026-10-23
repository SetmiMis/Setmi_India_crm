// Business vocabularies — verified against src/Code.js and src/CallLog.js. The database
// enforces the same values with CHECK constraints (supabase/migrations/*_crm_tables.sql).

export const COMPANY = { name: "SETMI INDIA", tagline: "Engineered for the Extraordinary" } as const;

export const STAGES = ["New", "Quoted", "Follow-up", "Won", "Lost", "Dispatched", "Closed"] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES: readonly Stage[] = ["New", "Quoted", "Follow-up"];
export const TERMINAL_STAGES: readonly Stage[] = ["Won", "Lost", "Dispatched", "Closed"];
export const CONVERTED_STAGES: readonly Stage[] = ["Won", "Dispatched", "Closed"];

export const PRIORITIES = ["Hot", "Warm", "Cold"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TIMELINES = ["Immediate", "Fortnight", "Just Exploring"] as const;
export type Timeline = (typeof TIMELINES)[number];

export const ESCALATIONS = ["Proprietor", "Shop Floor"] as const;
export const GRADES = ["A", "B", "C"] as const;

export const CALL_STATUSES = ["Connected", "Not Connected", "Busy", "Switched Off", "No Answer"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const INTEREST_LEVELS = ["Interested", "Maybe / Thinking", "Not Interested"] as const;

// Fallback list; the live list comes from public.lead_sources.
export const SOURCES = [
  "IndiaMART", "Phone", "TradeIndia", "Exhibition", "WhatsApp", "Referral", "Walk-in", "Website", "Meta Ads", "Other",
] as const;

/** Allowed next stages — mirrors private.stage_transition_allowed() in the database. */
export function nextStages(from: Stage, isAdmin: boolean): Stage[] {
  switch (from) {
    case "New":
      return ["Quoted", "Follow-up", "Won", "Lost"];
    case "Quoted":
      return ["Follow-up", "Won", "Lost"];
    case "Follow-up":
      return ["Quoted", "Won", "Lost"];
    case "Won":
      return ["Dispatched", "Closed"];
    case "Dispatched":
      return ["Closed"];
    case "Lost":
      return isAdmin ? ["Follow-up"] : [];
    default:
      return [];
  }
}

/** Legacy gradeFor_ — kept in TS for instant form feedback; the database recomputes on save. */
export function gradeFor(qty: number | null | undefined, timeline: string | null | undefined): "A" | "B" | "C" | null {
  const t = TIMELINES.indexOf(timeline as Timeline);
  if (!qty || t < 0) return null;
  const row = qty > 500 ? 2 : qty >= 20 ? 1 : 0;
  const col = 2 - t;
  if (row === 2) return col >= 1 ? "A" : "B";
  if (row === 1) return col === 2 ? "A" : col === 1 ? "B" : "C";
  return col === 2 ? "B" : "C";
}
