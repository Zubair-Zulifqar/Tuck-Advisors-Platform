import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { ApiForm, str } from "@/components/app/actions";
import { Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function NewslettersPage() {
  const d = await query(async (tx, auth) => ({
    items: (await tx.query<{ id: string; title: string; status: string; scheduled_at: string | null; sent_at: string | null; stats: Record<string, number>; created_at: string }>("select * from newsletters where organization_id = $1 order by created_at desc", [auth.organizationId])).rows,
    subs: (await tx.query<{ status: string; n: string }>("select status, count(*) as n from newsletter_subscribers where organization_id = $1 group by status", [auth.organizationId])).rows,
    auth,
  }));
  const subs = Object.fromEntries(d.subs.map((s) => [s.status, Number(s.n)]));
  return (
    <>
      <PageHeader eyebrow="Content" title="Newsletters" description={`${subs.subscribed ?? 0} subscribed · ${subs.pending ?? 0} pending · ${subs.unsubscribed ?? 0} unsubscribed. Every issue needs approval by a second team member before it can be scheduled.`}
        actions={can(d.auth, "outreach:draft") ? (
          <Disclosure label="Research & draft issue">
            <ApiForm path="/api/v1/newsletters" submitLabel="Research and draft" toBody={(f) => ({ title: str(f, "title"), topic: str(f, "topic") })}>
              <input name="title" required placeholder="Issue title" className="field" />
              <input name="topic" required placeholder="Topic to research, e.g. vertical SaaS consolidation in healthcare" className="field" />
            </ApiForm>
          </Disclosure>
        ) : undefined} />
      <Card>
        <CardHeader title="Issues" />
        <Table head={["Issue", "Status", "Scheduled", "Delivery"]}>
          {d.items.map((n) => (
            <tr key={n.id}>
              <Td><Link className="font-medium hover:underline" href={`/app/newsletters/${n.id}`}>{n.title}</Link><span className="muted block text-xs">{fmtDate(n.created_at)}</span></Td>
              <Td><Badge tone={n.status === "sent" ? "good" : n.status === "in_review" ? "warn" : "neutral"}>{n.status.replace("_", " ")}</Badge></Td>
              <Td className="text-xs">{fmtDate(n.scheduled_at, true)}</Td>
              <Td className="text-xs">{n.sent_at ? `${n.stats.sent ?? 0}/${n.stats.recipients ?? 0} sent${n.stats.simulated ? ` (${n.stats.simulated} simulated)` : ""}` : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
