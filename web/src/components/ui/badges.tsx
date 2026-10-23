import { cn } from "@/lib/cn";
import { followUpStatus } from "@/lib/domain/dates";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap";

const STAGE: Record<string, string> = {
  New: "bg-blue/15 text-blue",
  Quoted: "bg-gold/15 text-gold",
  "Follow-up": "bg-cyan/15 text-cyan-dk",
  Won: "bg-green/15 text-green-dk",
  Lost: "bg-red/15 text-red",
  Dispatched: "bg-green/25 text-green-dk",
  Closed: "bg-chip text-muted",
};

export function StageBadge({ stage }: { stage: string }) {
  return <span className={cn(pill, STAGE[stage] ?? "bg-chip text-muted")}>{stage}</span>;
}

const PRIORITY: Record<string, string> = {
  Hot: "bg-red/15 text-red",
  Warm: "bg-gold/15 text-gold",
  Cold: "bg-blue/15 text-blue",
};

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-muted">—</span>;
  return <span className={cn(pill, PRIORITY[priority])}>{priority}</span>;
}

export function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return null;
  const c = grade === "A" ? "bg-green/20 text-green-dk" : grade === "B" ? "bg-gold/15 text-gold" : "bg-chip text-muted";
  return <span className={cn(pill, c)} title="Lead grade (Qty × Timeline)">Grade {grade}</span>;
}

export function FollowUpBadge({ date, today }: { date: string | null; today?: string }) {
  const s = followUpStatus(date, today);
  const c =
    s === "Overdue" ? "bg-red/15 text-red" : s === "Today" ? "bg-green/15 text-green-dk" : s === "Tomorrow" ? "bg-gold/15 text-gold" : "bg-chip text-muted";
  return <span className={cn(pill, c)}>{s}</span>;
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "info" }) {
  const c = { neutral: "bg-chip text-muted", good: "bg-green/15 text-green-dk", bad: "bg-red/15 text-red", warn: "bg-gold/15 text-gold", info: "bg-cyan/15 text-cyan-dk" }[tone];
  return <span className={cn(pill, c)}>{children}</span>;
}
