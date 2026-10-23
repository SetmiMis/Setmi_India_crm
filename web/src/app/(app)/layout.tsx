import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { signOut } from "@/server/actions/auth";
import { Toaster } from "@/components/toaster";

type Badges = { overdue: number; due_today: number; pending_approvals: number; incoming_transfers: number };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const badges = await readRpc<Badges>("follow_up_badge_counts").catch(() => null);

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    { href: "/follow-ups", label: "Follow-ups", icon: "CalendarClock", badge: badges ? badges.overdue + badges.due_today : 0, badgeTone: badges?.overdue ? "bad" : "info" },
    { href: "/leads", label: "Available Leads", icon: "Inbox" },
    { href: "/pipeline", label: "Pipeline", icon: "KanbanSquare", badge: badges?.incoming_transfers ?? 0 },
    { href: "/customers", label: "Customers", icon: "Users" },
    { href: "/new-enquiry", label: "New Enquiry", icon: "PlusCircle" },
    { href: "/approvals", label: "Pending Approvals", icon: "ClipboardCheck", badge: badges?.pending_approvals ?? 0 },
    { href: "/import", label: "Bulk Import", icon: "Upload" },
    { href: "/calls", label: "Call Management", icon: "PhoneCall" },
    ...(user.isAdmin
      ? ([
          { href: "/reports", label: "Reports", icon: "BarChart3", section: "Admin" },
          { href: "/team-performance", label: "Team Performance", icon: "Trophy" },
          { href: "/users", label: "Users & Team", icon: "UserCog" },
          { href: "/admin", label: "Admin Settings", icon: "Settings2" },
        ] as NavItem[])
      : []),
    { href: "/map", label: "MAP Analytics", icon: "Map", section: "Insights" },
    { href: "/analysis", label: "Data Analysis", icon: "PieChart" },
    { href: "/guide", label: "How it Works", icon: "BookOpen" },
    { href: "/settings", label: "My Settings", icon: "UserCircle" },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar nav={nav} userName={user.fullName} role={user.role} signOut={signOut} />
      <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-6 lg:pt-6">
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
