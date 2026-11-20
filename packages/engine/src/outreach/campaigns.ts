import { z } from "zod";
import { COMPLIANCE_FOOTER, type CampaignInput, renderTemplate } from "@tuck/shared";
import { type Queryable, asSystem, createActivity, ForbiddenError, NotFoundError, ValidationError } from "@tuck/db";
import type { EngineDeps } from "../deps";
import { dispatchEvent } from "../automation/runtime";

export interface CampaignRow {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  subject_template: string;
  body_template: string;
  segment: { tags?: string[]; companyKinds?: string[]; requireVerifiedEmail?: boolean };
  daily_send_limit: number;
  from_name: string;
  from_email: string;
  scheduled_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
}

export async function createCampaign(tx: Queryable, orgId: string, userId: string, input: CampaignInput) {
  const { rows } = await tx.query<CampaignRow>(
    `insert into public.outreach_campaigns (organization_id, name, subject_template, body_template, segment, daily_send_limit, from_name, from_email, scheduled_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [orgId, input.name, input.subjectTemplate, input.bodyTemplate, JSON.stringify(input.segment), input.dailySendLimit, input.fromName, input.fromEmail, input.scheduledAt ?? null, userId],
  );
  return rows[0]!;
}

export async function getCampaign(tx: Queryable, orgId: string, id: string) {
  const { rows } = await tx.query<CampaignRow>("select * from public.outreach_campaigns where organization_id = $1 and id = $2", [orgId, id]);
  if (!rows[0]) throw new NotFoundError("Campaign");
  return rows[0];
}

interface Recipient {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  title: string | null;
  company_name: string | null;
  industry: string | null;
}

/** Resolve the segment, excluding suppressed addresses and anyone contacted by another campaign in the last 30 days. */
export async function resolveSegment(tx: Queryable, orgId: string, c: CampaignRow, contactIds?: string[]) {
  const seg = c.segment ?? {};
  const { rows } = await tx.query<Recipient & { excluded_reason: string | null }>(
    `select ct.id, ct.first_name, ct.last_name, ct.email, ct.title, co.name as company_name, co.industry,
       case
         when s.email is not null then 'suppressed'
         when $5 and ct.email_status not in ('provider_verified','manually_verified') then 'unverified_email'
         when exists (select 1 from public.outreach_messages m where m.organization_id = $1 and m.contact_id = ct.id and m.campaign_id <> $6
                      and m.status in ('queued','sent','delivered','replied') and m.sent_at > now() - interval '30 days') then 'recently_contacted'
         else null end as excluded_reason
     from public.contacts ct
     left join public.companies co on co.id = ct.company_id
     left join public.suppression_list s on s.organization_id = ct.organization_id and s.email = ct.email
     where ct.organization_id = $1 and ct.deleted_at is null and ct.email is not null and ct.email_status <> 'invalid'
       and (cardinality($2::text[]) = 0 or ct.tags && $2::text[] or co.tags && $2::text[])
       and (cardinality($3::text[]) = 0 or co.kind = any($3::text[]))
       and ($4::uuid[] is null or ct.id = any($4::uuid[]))
     order by ct.created_at limit 2000`,
    [orgId, seg.tags ?? [], seg.companyKinds ?? [], contactIds?.length ? contactIds : null, seg.requireVerifiedEmail !== false, c.id],
  );
  return { eligible: rows.filter((r) => !r.excluded_reason), excluded: rows.filter((r) => r.excluded_reason) };
}

const personalization = z.object({ opener: z.string().max(400) });

/** Generate per-recipient drafts. Nothing is sent; every message stays "draft" until the campaign is approved. */
export async function generateCampaignMessages(deps: EngineDeps, orgId: string, userId: string, campaignId: string, opts: { contactIds?: string[]; personalize?: boolean } = {}) {
  const { campaign, eligible, excluded } = await asSystem(deps.db, async (tx) => {
    const campaign = await getCampaign(tx, orgId, campaignId);
    if (!["draft", "in_review"].includes(campaign.status)) throw new ValidationError("Messages can only be generated while the campaign is a draft");
    return { campaign, ...(await resolveSegment(tx, orgId, campaign, opts.contactIds)) };
  });
  let created = 0;
  const warnings: { contactId: string; missing: string[] }[] = [];
  for (const r of eligible) {
    let opener = "";
    if (opts.personalize) {
      const out = await deps.llm.completeJson(
        personalization,
        {
          task: "outreach_personalization",
          system: "You write one short, professional, non-pushy opening sentence for a B2B email from an M&A advisory firm. Use only the facts given. No flattery, no claims about the recipient you cannot support.",
          user: JSON.stringify({ firstName: r.first_name, title: r.title, company: r.company_name, industry: r.industry }),
        },
        () => ({ opener: r.company_name && r.industry ? `I've been following developments in ${r.industry.toLowerCase()} and ${r.company_name} came up in our research.` : "" }),
      );
      opener = out.opener;
    }
    const vars = {
      first_name: r.first_name,
      last_name: r.last_name ?? "",
      title: r.title ?? "",
      "company.name": r.company_name ?? "",
      "company.industry": r.industry ?? "",
      personalized_opener: opener,
      sender_name: campaign.from_name,
      unsubscribe_url: `${deps.env.APP_URL ?? "http://localhost:3000"}/unsubscribe?e=${encodeURIComponent(r.email)}&o=${orgId}`,
    };
    const subject = renderTemplate(campaign.subject_template, vars);
    const body = renderTemplate(campaign.body_template + COMPLIANCE_FOOTER, vars);
    const missing = [...new Set([...subject.missing, ...body.missing])];
    if (missing.length) warnings.push({ contactId: r.id, missing });
    const res = await asSystem(
      deps.db,
      (tx) =>
        tx.query(
          `insert into public.outreach_messages (organization_id, campaign_id, contact_id, to_email, subject, body, status, error)
           values ($1,$2,$3,$4,$5,$6,'draft',$7)
           on conflict (campaign_id, contact_id) do update set subject = excluded.subject, body = excluded.body, error = excluded.error
             where outreach_messages.status = 'draft'
           returning id`,
          [orgId, campaignId, r.id, r.email, subject.text, body.text, missing.length ? `Unresolved fields: ${missing.join(", ")}` : null],
        ),
      userId,
    );
    created += res.rows.length;
  }
  return { created, excluded: excluded.map((e) => ({ contactId: e.id, reason: e.excluded_reason })), warnings };
}

export async function submitCampaignForReview(tx: Queryable, orgId: string, campaignId: string) {
  const c = await getCampaign(tx, orgId, campaignId);
  if (c.status !== "draft") throw new ValidationError("Only draft campaigns can be submitted for review");
  const { rows } = await tx.query<{ n: string }>("select count(*) as n from public.outreach_messages where campaign_id = $1", [campaignId]);
  if (Number(rows[0]?.n) === 0) throw new ValidationError("Generate and review messages before submitting");
  await tx.query("update public.outreach_campaigns set status = 'in_review' where id = $1", [campaignId]);
}

/** Compliance gate checked at approval time. */
export async function campaignComplianceIssues(tx: Queryable, c: CampaignRow) {
  const issues: string[] = [];
  const { rows } = await tx.query<{ unresolved: string; total: string; no_unsub: string }>(
    `select count(*) filter (where error is not null) as unresolved, count(*) as total,
            count(*) filter (where body not ilike '%unsubscribe%') as no_unsub
     from public.outreach_messages where campaign_id = $1 and status = 'draft'`,
    [c.id],
  );
  const r = rows[0]!;
  if (Number(r.total) === 0) issues.push("Campaign has no draft messages");
  if (Number(r.unresolved) > 0) issues.push(`${r.unresolved} message(s) have unresolved template fields`);
  if (Number(r.no_unsub) > 0) issues.push(`${r.no_unsub} message(s) are missing an unsubscribe option`);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.from_email)) issues.push("Sender address is invalid");
  if (c.daily_send_limit > 200) issues.push("Daily send limit exceeds the 200/day policy maximum");
  return issues;
}

/** Explicit human approval. Requires outreach:approve (checked by caller) and a different person than the author. */
export async function approveCampaign(tx: Queryable, orgId: string, approverId: string, campaignId: string, opts: { allowSelfApproval?: boolean } = {}) {
  const c = await getCampaign(tx, orgId, campaignId);
  if (c.status !== "in_review") throw new ValidationError("Campaign must be in review to approve");
  if (c.created_by === approverId && !opts.allowSelfApproval) throw new ForbiddenError("A campaign must be approved by someone other than its author");
  const issues = await campaignComplianceIssues(tx, c);
  if (issues.length) throw new ValidationError("Compliance checks failed", { issues });
  await tx.query("update public.outreach_messages set status = 'approved' where campaign_id = $1 and status = 'draft'", [campaignId]);
  await tx.query("update public.outreach_campaigns set status = $2, approved_by = $3, approved_at = now() where id = $1", [campaignId, c.scheduled_at ? "scheduled" : "approved", approverId]);
  return getCampaign(tx, orgId, campaignId);
}

export async function setCampaignStatus(tx: Queryable, orgId: string, campaignId: string, action: "start" | "pause" | "cancel" | "resume") {
  const c = await getCampaign(tx, orgId, campaignId);
  const transitions: Record<string, [string[], string]> = {
    start: [["approved", "scheduled"], "sending"],
    resume: [["paused"], "sending"],
    pause: [["sending", "scheduled"], "paused"],
    cancel: [["draft", "in_review", "approved", "scheduled", "sending", "paused"], "cancelled"],
  };
  const [from, to] = transitions[action]!;
  if (!from.includes(c.status)) throw new ValidationError(`Cannot ${action} a campaign that is ${c.status}`);
  if (to === "sending" && !c.approved_by) throw new ForbiddenError("Campaign has not been approved");
  await tx.query("update public.outreach_campaigns set status = $2 where id = $1", [campaignId, to]);
}

/** Worker: send approved messages for active campaigns within daily limits, re-checking suppression at send time. */
export async function sendCampaignBatch(deps: EngineDeps, limitPerCampaign = 25) {
  const campaigns = await asSystem(deps.db, async (tx) => {
    await tx.query("update public.outreach_campaigns set status = 'sending' where status = 'scheduled' and scheduled_at <= now() and approved_by is not null");
    const { rows } = await tx.query<CampaignRow & { sent_today: string }>(
      `select c.*, (select count(*) from public.outreach_messages m where m.campaign_id = c.id and m.sent_at > now() - interval '24 hours') as sent_today
       from public.outreach_campaigns c where c.status = 'sending' and c.approved_by is not null`,
    );
    return rows;
  });
  const results: { campaignId: string; sent: number; suppressed: number; failed: number }[] = [];
  for (const c of campaigns) {
    const budget = Math.min(limitPerCampaign, c.daily_send_limit - Number(c.sent_today));
    const r = { campaignId: c.id, sent: 0, suppressed: 0, failed: 0 };
    if (budget > 0) {
      const msgs = await asSystem(deps.db, async (tx) => {
        const { rows } = await tx.query<{ id: string; to_email: string; subject: string; body: string; contact_id: string; suppressed: boolean }>(
          `update public.outreach_messages m set status = 'queued' where m.id in (
             select id from public.outreach_messages where campaign_id = $1 and status = 'approved' order by created_at limit $2 for update skip locked)
           returning m.id, m.to_email, m.subject, m.body, m.contact_id,
             exists (select 1 from public.suppression_list s where s.organization_id = m.organization_id and s.email = m.to_email) as suppressed`,
          [c.id, budget],
        );
        return rows;
      });
      for (const m of msgs) {
        if (m.suppressed) {
          await asSystem(deps.db, (tx) => tx.query("update public.outreach_messages set status = 'suppressed' where id = $1", [m.id]));
          r.suppressed++;
          continue;
        }
        try {
          const sent = await deps.email.send({
            from: `${c.from_name} <${c.from_email}>`,
            to: m.to_email,
            subject: m.subject,
            text: m.body,
            headers: { "List-Unsubscribe": `<mailto:${c.from_email}?subject=unsubscribe>` },
            tags: [{ name: "campaign", value: c.id }],
          });
          await asSystem(deps.db, async (tx) => {
            await tx.query("update public.outreach_messages set status = 'sent', provider_message_id = $2, sent_at = now(), error = $3 where id = $1", [
              m.id,
              sent.providerMessageId,
              sent.status === "simulated" ? "Simulated send (no email provider configured)" : null,
            ]);
            await createActivity(tx, c.organization_id, null, { type: "outreach", subject: `Outreach sent: ${m.subject}`.slice(0, 300), contactId: m.contact_id, externalRef: `msg:${m.id}`, metadata: { campaignId: c.id, simulated: sent.status === "simulated" } });
          });
          r.sent++;
        } catch (e) {
          await asSystem(deps.db, (tx) => tx.query("update public.outreach_messages set status = 'failed', error = $2 where id = $1", [m.id, (e as Error).message.slice(0, 500)]));
          r.failed++;
        }
      }
    }
    const remaining = await asSystem(deps.db, (tx) => tx.query<{ n: string }>("select count(*) as n from public.outreach_messages where campaign_id = $1 and status in ('approved','queued')", [c.id]));
    if (Number(remaining.rows[0]?.n) === 0) await asSystem(deps.db, (tx) => tx.query("update public.outreach_campaigns set status = 'completed' where id = $1", [c.id]));
    results.push(r);
  }
  return results;
}

/** Provider webhook events (bounce / complaint / delivered). Bounces and complaints are suppressed permanently. */
export async function applyDeliveryEvent(deps: EngineDeps, ev: { providerMessageId: string; status: "delivered" | "bounced" | "complained" }) {
  return asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<{ id: string; organization_id: string; to_email: string }>("select id, organization_id, to_email from public.outreach_messages where provider_message_id = $1", [ev.providerMessageId]);
    const m = rows[0];
    if (!m) return null;
    if (ev.status === "delivered") await tx.query("update public.outreach_messages set status = 'delivered' where id = $1 and status = 'sent'", [m.id]);
    else {
      await tx.query("update public.outreach_messages set status = 'bounced', error = $2 where id = $1", [m.id, ev.status]);
      await tx.query("insert into public.suppression_list (organization_id, email, reason) values ($1,$2,$3) on conflict do nothing", [m.organization_id, m.to_email, ev.status === "bounced" ? "bounce" : "complaint"]);
      if (ev.status === "bounced") await tx.query("update public.contacts set email_status = 'invalid' where organization_id = $1 and email = $2", [m.organization_id, m.to_email]);
    }
    return m.id;
  });
}

/** Reply detection (from Gmail metadata sync or inbound webhook). */
export async function recordReply(deps: EngineDeps, orgId: string, messageId: string) {
  const m = await asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<{ id: string; contact_id: string; campaign_id: string; subject: string }>(
      "update public.outreach_messages set status = 'replied', replied_at = now() where organization_id = $1 and id = $2 and status in ('sent','delivered') returning id, contact_id, campaign_id, subject",
      [orgId, messageId],
    );
    if (rows[0]) await createActivity(tx, orgId, null, { type: "email", subject: `Reply received: ${rows[0].subject}`.slice(0, 300), contactId: rows[0].contact_id, externalRef: `reply:${rows[0].id}`, metadata: { campaignId: rows[0].campaign_id } });
    return rows[0];
  });
  if (m) await dispatchEvent(deps, orgId, { type: "outreach.reply_received", payload: { messageId: m.id, contactId: m.contact_id, campaignId: m.campaign_id }, dedupeKey: `reply:${m.id}` });
  return m ?? null;
}

export async function suppressEmail(tx: Queryable, orgId: string, email: string, reason: "unsubscribe" | "manual" = "unsubscribe") {
  await tx.query("insert into public.suppression_list (organization_id, email, reason) values ($1, lower($2), $3) on conflict do nothing", [orgId, email, reason]);
  await tx.query("update public.outreach_messages set status = 'suppressed' where organization_id = $1 and to_email = lower($2) and status in ('draft','approved')", [orgId, email]);
  await tx.query("update public.newsletter_subscribers set status = 'unsubscribed' where organization_id = $1 and email = lower($2)", [orgId, email]);
}

export async function campaignAnalytics(tx: Queryable, orgId: string, campaignId: string) {
  const { rows } = await tx.query<{ status: string; n: string }>("select status, count(*) as n from public.outreach_messages where organization_id = $1 and campaign_id = $2 group by status", [orgId, campaignId]);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const sent = (by.sent ?? 0) + (by.delivered ?? 0) + (by.replied ?? 0) + (by.bounced ?? 0);
  return {
    byStatus: by,
    sent,
    replyRate: sent ? (by.replied ?? 0) / sent : 0,
    bounceRate: sent ? (by.bounced ?? 0) / sent : 0,
  };
}
