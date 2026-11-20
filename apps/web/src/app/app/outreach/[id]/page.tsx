import { notFound } from "next/navigation";
import { campaignAnalytics, getCampaign } from "@tuck/engine";
import { NotFoundError } from "@tuck/db";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { MessageReview } from "@/components/app/message-review";
import { can, query } from "@/server/session";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => {
    try {
      const c = await getCampaign(tx, auth.organizationId, id);
      const messages = (await tx.query<{ id: string; to_email: string; subject: string; body: string; status: string; error: string | null; sent_at: string | null; contact_name: string }>(
        "select m.*, ct.first_name || ' ' || coalesce(ct.last_name,'') as contact_name from outreach_messages m join contacts ct on ct.id = m.contact_id where m.campaign_id = $1 order by m.created_at limit 500", [id])).rows;
      return { c, messages, stats: await campaignAnalytics(tx, auth.organizationId, id), auth };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!d) notFound();
  const { c, auth } = d;
  const base = `/api/v1/outreach/campaigns/${c.id}`;
  const approver = can(auth, "outreach:approve");
  return (
    <>
      <PageHeader eyebrow="Campaign" title={c.name} description={<>From {c.from_name} &lt;{c.from_email}&gt; · limit {c.daily_send_limit}/day · <Badge>{c.status.replace("_", " ")}</Badge>{c.approved_at && <span className="ml-2 text-xs">approved {new Date(c.approved_at).toLocaleString()}</span>}</>}
        actions={<>
          {c.status === "draft" && <ActionButton path={`${base}/generate`} body={{ personalize: true }}>Generate messages</ActionButton>}
          {c.status === "draft" && <ActionButton path={`${base}/submit`} variant="primary">Submit for review</ActionButton>}
          {c.status === "in_review" && approver && <ActionButton path={`${base}/approve`} variant="brass" confirm="Approve this campaign? You confirm you have reviewed the messages and recipients have a legitimate basis for contact.">Approve</ActionButton>}
          {["approved", "scheduled"].includes(c.status) && approver && <ActionButton path={`${base}/start`} variant="brass" confirm="Start sending approved messages within the daily limit?">Start sending</ActionButton>}
          {c.status === "sending" && <ActionButton path={`${base}/pause`}>Pause</ActionButton>}
          {c.status === "paused" && approver && <ActionButton path={`${base}/resume`}>Resume</ActionButton>}
          {!["completed", "cancelled"].includes(c.status) && <ActionButton path={`${base}/cancel`} variant="ghost" confirm="Cancel this campaign?">Cancel</ActionButton>}
        </>} />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Messages" value={Object.values(d.stats.byStatus).reduce((a, b) => a + b, 0)} />
        <Stat label="Sent" value={d.stats.sent} />
        <Stat label="Reply rate" value={`${(d.stats.replyRate * 100).toFixed(1)}%`} />
        <Stat label="Bounce rate" value={`${(d.stats.bounceRate * 100).toFixed(1)}%`} />
      </div>
      <Card>
        <CardHeader title="Messages" subtitle={c.status === "draft" ? "Review and edit each message before submitting. Messages with unresolved fields block approval." : "Locked after submission."} />
        <MessageReview campaignId={c.id} editable={c.status === "draft"} messages={d.messages} />
      </Card>
    </>
  );
}
