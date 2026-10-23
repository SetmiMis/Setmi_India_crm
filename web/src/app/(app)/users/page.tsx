import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth";
import { userClient } from "@/lib/supabase/server";
import { teamMembers } from "@/server/queries";
import { setTeamMemberActive, updateUser } from "@/server/actions/admin";
import { PageHeader, Card } from "@/components/ui/layout";
import { Pill } from "@/components/ui/badges";
import { ActionButton } from "@/components/action-form";
import { niceTimestamp } from "@/lib/domain/dates";
import { AddTeamMemberForm, CreateUserForm, ResetPasswordForm } from "./user-forms";

export const metadata: Metadata = { title: "Users & Team" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const supabase = await userClient();
  const [{ data: profiles }, team] = await Promise.all([
    supabase.from("profiles").select("id, username, full_name, role, active, email, created_at").order("full_name"),
    teamMembers(true),
  ]);
  return (
    <>
      <PageHeader title="Users & Team" subtitle="Logins (who can sign in) and the Lead By roster (who can own leads)." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Logins" className="p-0">
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {(profiles ?? []).map((p) => (
                  <tr key={p.id}>
                    <td><div className="font-medium">{p.full_name}</div><div className="text-xs text-muted">@{p.username} · {p.email} · since {niceTimestamp(p.created_at)}</div></td>
                    <td><Pill tone={p.role === "admin" ? "info" : "neutral"}>{p.role}</Pill></td>
                    <td>{p.active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Inactive</Pill>}</td>
                    <td>
                      {p.id === me.id ? <span className="text-xs text-muted">This is you</span> : (
                        <div className="flex flex-wrap gap-1.5">
                          <ActionButton action={updateUser} fields={{ id: p.id, role: p.role === "admin" ? "rep" : "admin" }}
                            label={p.role === "admin" ? "Make rep" : "Make admin"} variant="secondary"
                            confirm={`Change ${p.full_name}'s role to ${p.role === "admin" ? "rep" : "admin"}?`} />
                          <ActionButton action={updateUser} fields={{ id: p.id, active: p.active ? "false" : "true" }}
                            label={p.active ? "Deactivate" : "Activate"} variant={p.active ? "danger" : "success"}
                            confirm={p.active ? `Deactivate ${p.full_name}? They are signed out and lose access immediately.` : undefined} />
                          <details><summary className="cursor-pointer text-sm text-cyan-dk">Reset password</summary><ResetPasswordForm id={p.id} /></details>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Create login"><CreateUserForm /></Card>
          <Card title="Lead By roster">
            <AddTeamMemberForm />
            <ul className="mt-3 divide-y divide-line text-sm">
              {team.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{t.name} {t.profile_id ? <Pill tone="info">login</Pill> : null} {!t.active ? <Pill tone="bad">inactive</Pill> : null}</span>
                  <ActionButton action={setTeamMemberActive} fields={{ id: t.id, active: t.active ? "false" : "true" }} label={t.active ? "Deactivate" : "Activate"} variant="ghost" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
