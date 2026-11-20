import { integrationStatuses } from "@tuck/integrations";
import { ROLES } from "@tuck/shared";
import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { RoleSelect } from "@/components/app/role-select";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function SettingsPage() {
  const d = await query(async (tx, auth) => ({
    members: (await tx.query<{ user_id: string; role: string; email: string; name: string | null }>("select m.user_id, m.role, u.email, u.name from memberships m join users u on u.id = m.user_id where m.organization_id = $1 order by u.name", [auth.organizationId])).rows,
    audit: can(auth, "audit:read") ? (await tx.query<{ id: string; action: string; table_name: string; record_id: string | null; created_at: string; actor: string | null; changes: Record<string, unknown> | null }>(
      "select a.id, a.action, a.table_name, a.record_id, a.created_at, u.name as actor, a.changes from audit_logs a left join users u on u.id = a.actor_user_id where a.organization_id = $1 order by a.id desc limit 60", [auth.organizationId])).rows : [],
    auth,
  }));
  const integrations = integrationStatuses(process.env);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" description="Members, integration status and the audit trail." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Members & roles" subtitle="Owner · Admin (approvals, integrations) · Analyst (CRM + research) · Viewer (read-only)" />
          <Table head={["Member", "Role"]}>
            {d.members.map((m) => (
              <tr key={m.user_id}><Td>{m.name}<span className="muted block text-xs">{m.email}</span></Td><Td>{can(d.auth, "members:manage") && m.user_id !== d.auth.userId ? <RoleSelect userId={m.user_id} role={m.role} roles={[...ROLES]} /> : <Badge>{m.role}</Badge>}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Integrations" subtitle="Credentials live in server environment variables / encrypted storage — never in the browser or extension." />
          <Table head={["Integration", "Mode", "Notes"]}>
            {integrations.map((i) => (
              <tr key={i.provider}><Td>{i.label}<span className="muted block text-xs">{i.category}</span></Td><Td><Badge tone={i.mode === "live" ? "good" : i.mode === "mock" ? "warn" : "neutral"}>{i.mode}</Badge></Td><Td className="muted text-xs">{i.reason}{i.missing.length > 0 && <span className="block">Set: {i.missing.join(", ")}</span>}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>
      {d.audit.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Audit log" subtitle="Database-level triggers record who changed what, including field-level diffs." />
          <Table head={["When", "Actor", "Action", "Record", "Changes"]}>
            {d.audit.map((a) => (
              <tr key={a.id}><Td className="muted whitespace-nowrap text-xs">{fmtDate(a.created_at, true)}</Td><Td className="text-xs">{a.actor ?? "System"}</Td><Td><Badge>{a.action}</Badge></Td><Td className="text-xs">{a.table_name}</Td><Td className="max-w-md truncate font-mono text-[11px]">{a.changes ? Object.keys(a.changes).slice(0, 6).join(", ") : "—"}</Td></tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
