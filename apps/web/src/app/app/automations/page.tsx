import Link from "next/link";
import { AUTOMATION_TEMPLATES } from "@tuck/engine";
import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { AutomationBuilder } from "@/components/app/automation-builder";
import { Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { relTime } from "@/lib/format";

export default async function AutomationsPage() {
  const d = await query(async (tx, auth) => ({
    items: (await tx.query<{ id: string; name: string; description: string; trigger_type: string; status: string; updated_at: string; definition: { actions: { type: string; requiresApproval: boolean }[] }; runs_7d: string; failed: string; awaiting: string }>(
      `select a.*, count(e.*) filter (where e.created_at > now() - interval '7 days') as runs_7d, count(e.*) filter (where e.status = 'failed') as failed, count(e.*) filter (where e.status = 'awaiting_approval') as awaiting
       from automations a left join automation_executions e on e.automation_id = a.id where a.organization_id = $1 group by a.id order by a.created_at`, [auth.organizationId])).rows,
    approvals: (await tx.query<{ id: string; automation_id: string; name: string; event_type: string; created_at: string; current_step: number }>(
      "select e.id, e.automation_id, a.name, e.event_type, e.created_at, e.current_step from automation_executions e join automations a on a.id = e.automation_id where e.organization_id = $1 and e.status = 'awaiting_approval' order by e.created_at", [auth.organizationId])).rows,
    auth,
  }));
  const manage = can(d.auth, "automation:manage");
  return (
    <>
      <PageHeader eyebrow="CRM automation engine" title="Automations" description="Event-driven workflows built from reusable triggers, conditions and actions — with delays, retries, deduplication, execution logs and human approval gates."
        actions={manage ? <Disclosure label="Build automation"><AutomationBuilder /></Disclosure> : undefined} />
      {d.approvals.length > 0 && (
        <Card className="mb-6 border-amber-300">
          <CardHeader title={`Waiting for approval (${d.approvals.length})`} />
          <ul className="divide-y divide-[var(--border)] text-sm">{d.approvals.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"><span><Link href={`/app/automations/${a.automation_id}`} className="font-medium hover:underline">{a.name}</Link> <span className="muted text-xs">step {a.current_step + 1} · {a.event_type} · {relTime(a.created_at)}</span></span>
              {can(d.auth, "automation:approve") && <span className="flex gap-2"><ActionButton path={`/api/v1/automations/executions/${a.id}`} body={{ action: "approve" }} variant="brass">Approve</ActionButton><ActionButton path={`/api/v1/automations/executions/${a.id}`} body={{ action: "cancel" }} variant="ghost">Reject</ActionButton></span>}
            </li>))}
          </ul>
        </Card>
      )}
      <Card>
        <Table head={["Automation", "Trigger", "Steps", "Runs (7d)", "Status", ""]}>
          {d.items.map((a) => (
            <tr key={a.id}>
              <Td><Link href={`/app/automations/${a.id}`} className="font-medium hover:underline">{a.name}</Link><span className="muted block text-xs">{a.description}</span></Td>
              <Td><code className="text-xs">{a.trigger_type}</code></Td>
              <Td className="text-xs">{a.definition.actions.map((s) => s.type).join(" → ")}</Td>
              <Td className="tabular-nums">{a.runs_7d}{Number(a.failed) > 0 && <Badge tone="bad" className="ml-2">{a.failed} failed</Badge>}</Td>
              <Td><Badge tone={a.status === "active" ? "good" : "neutral"}>{a.status}</Badge></Td>
              <Td>{manage && (a.status === "active" ? <ActionButton path={`/api/v1/automations/${a.id}`} method="PATCH" body={{ status: "paused" }} variant="ghost">Pause</ActionButton> : <ActionButton path={`/api/v1/automations/${a.id}`} method="PATCH" body={{ status: "active" }}>Enable</ActionButton>)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <h2 className="mb-3 mt-8 font-serif text-lg font-semibold">Template library</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AUTOMATION_TEMPLATES.map((t) => (
          <Card key={t.key} className="flex flex-col p-4">
            <Badge tone="brass" className="self-start">{t.category}</Badge>
            <p className="mt-2 font-medium">{t.name}</p>
            <p className="muted mt-1 flex-1 text-sm">{t.description}</p>
            <p className="muted mt-2 text-xs"><code>{t.trigger.type}</code> → {t.actions.map((a) => a.type).join(" → ")}</p>
            {manage && <div className="mt-3"><ActionButton path="/api/v1/automations/templates" body={{ key: t.key }}>Install (paused)</ActionButton></div>}
          </Card>
        ))}
      </div>
    </>
  );
}
