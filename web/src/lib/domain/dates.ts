// Business calendar helpers. All business dates are Asia/Kolkata calendar days, carried as
// "YYYY-MM-DD" strings so no timezone shifting can happen between server and browser.

export const BUSINESS_TZ = "Asia/Kolkata";

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parse(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** Legacy addWorkingDays_: Sundays and listed holidays are skipped. */
export function addWorkingDays(from: string, n: number, holidays: ReadonlySet<string> = new Set()): string {
  let d = parse(from);
  let left = Math.max(0, n);
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    if (d.getUTCDay() !== 0 && !holidays.has(fmt(d))) left--;
  }
  return fmt(d);
}

export const FOLLOW_UP_INTERVAL = { Hot: 1, Warm: 2, Cold: 6 } as const;

export function computeNextFollowUp(priority: string | null | undefined, actual: string, holidays?: ReadonlySet<string>): string {
  const days = FOLLOW_UP_INTERVAL[priority as keyof typeof FOLLOW_UP_INTERVAL] ?? FOLLOW_UP_INTERVAL.Warm;
  return addWorkingDays(actual, days, holidays);
}

export type FollowUpStatus = "No Follow-up" | "Overdue" | "Today" | "Tomorrow" | "Upcoming";

export function followUpStatus(next: string | null | undefined, today: string = todayIST()): FollowUpStatus {
  if (!next) return "No Follow-up";
  const diff = daysBetween(today, next);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return "Upcoming";
}

const NICE = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const NICE_TS = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TZ,
});

/** "23 Oct 2026" for a business date, "" for empty. */
export function niceDate(d: string | null | undefined): string {
  if (!d) return "";
  return NICE.format(parse(d.slice(0, 10)));
}

/** "23 Oct 2026, 10:15 am" in IST for an instant. */
export function niceTimestamp(ts: string | null | undefined): string {
  if (!ts) return "";
  return NICE_TS.format(new Date(ts));
}

export function monthStart(today: string = todayIST()): string {
  return `${today.slice(0, 7)}-01`;
}
