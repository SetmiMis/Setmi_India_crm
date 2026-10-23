"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpen, CalendarClock, ClipboardCheck, Inbox, KanbanSquare, LayoutDashboard, LogOut, Map, Menu,
  PhoneCall, PieChart, PlusCircle, Settings2, Trophy, Upload, UserCircle, UserCog, Users, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/domain/constants";

const ICONS = {
  BarChart3, BookOpen, CalendarClock, ClipboardCheck, Inbox, KanbanSquare, LayoutDashboard, Map, PhoneCall, PieChart,
  PlusCircle, Settings2, Trophy, Upload, UserCircle, UserCog, Users,
} as const;

export type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
  badgeTone?: "bad" | "info";
  section?: string;
};

export function Sidebar({
  nav,
  userName,
  role,
  signOut,
}: {
  nav: NavItem[];
  userName: string;
  role: string;
  signOut: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-[var(--panel)] px-4 py-2.5 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="logo text-xl">
          SETMI <span className="in">INDIA</span>
        </Link>
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-chip"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="app-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      <nav
        id="app-nav"
        aria-label="Main"
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 -translate-x-full overflow-y-auto border-r border-line bg-[var(--panel-solid)] p-3 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open && "translate-x-0 shadow-2xl",
        )}
      >
        <div className="mb-4 px-2 pt-1">
          <Link href="/dashboard" className="logo text-2xl">
            SETMI <span className="in">INDIA</span>
          </Link>
          <p className="text-[11px] text-muted">{COMPANY.tagline}</p>
        </div>
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const Icon = ICONS[item.icon];
            const active = path === item.href || path.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                {item.section ? <p className="mb-1 mt-4 px-2.5 text-[10.5px] font-bold uppercase tracking-wider text-muted">{item.section}</p> : null}
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium hover:bg-chip",
                    active && "bg-cyan/12 font-semibold text-cyan-dk",
                  )}
                >
                  <Icon size={17} aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[11px] font-bold text-white",
                        item.badgeTone === "bad" ? "bg-red" : "bg-cyan",
                      )}
                    >
                      {item.badge > 999 ? "999+" : item.badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 border-t border-line px-2.5 pt-3 text-sm">
          <p className="font-semibold">{userName}</p>
          <p className="text-xs capitalize text-muted">{role}</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm text-red hover:bg-chip">
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </nav>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}
    </>
  );
}
