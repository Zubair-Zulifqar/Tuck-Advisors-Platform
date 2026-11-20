import Link from "next/link";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { CampaignForm } from "@/components/app/campaign";
import { Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function OutreachPage() {
  const d = await query(async (tx, auth) => ({
    campaigns: (await tx.query<{ id: string; name: string; status: string; created_at: string; daily_send_limit: number; total: string; sent: string; replied: string; bounced: string }>(
      `select c.*, count(m.*) as total, count(m.*) filter (where m.status in ('sent','delivered','replied','bounced')) as sent,
         count(m.*) filter (where m.status = 'replied') as replied, count(m.*) filter (where m.status = 'bounced') as bounced
       from outreach_campaigns c left join outreach_messages m on m.campaign_id = c.id where c.organization_id = $1 group by c.id order by c.created_at desc`, [auth.organizationId])).rows,
    templates: (await tx.query<{ id: string; name: string; subject: string; body: string }>("select * from communication_templates where organization_id = $1", [auth.organizationId])).rows,
    auth,
  }));
  return (
    <>
      <PageHeader eyebrow="Bulk outreach" title="Campaigns" description="Draft → generate personalised messages → review → approval by a second person → send within daily limits. Suppression lists, bounces and opt-outs are enforced at send time."
        actions={can(d.auth, "outreach:draft") ? <Disclosure label="New campaign"><CampaignForm templates={d.templates} /></Disclosure> : undefined} />
      <Card>
        <Table head={["Campaign", "Status", "Messages", "Sent", "Replies", "Bounces", "Created"]}>
          {d.campaigns.map((c) => (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:underline" href={`/app/outreach/${c.id}`}>{c.name}</Link><span className="muted block text-xs">limit {c.daily_send_limit}/day</span></Td>
              <Td><Badge tone={c.status === "sending" ? "info" : c.status === "completed" ? "good" : c.status === "in_review" ? "warn" : "neutral"}>{c.status.replace("_", " ")}</Badge></Td>
              <Td className="tabular-nums">{c.total}</Td><Td className="tabular-nums">{c.sent}</Td><Td className="tabular-nums">{c.replied}</Td><Td className="tabular-nums">{c.bounced}</Td>
              <Td className="muted text-xs">{fmtDate(c.created_at)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
