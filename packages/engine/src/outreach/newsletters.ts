import { z } from "zod";
import { type Queryable, asSystem, ForbiddenError, NotFoundError, ValidationError } from "@tuck/db";
import type { EngineDeps } from "../deps";

export interface NewsletterRow {
  id: string;
  organization_id: string;
  title: string;
  subject: string;
  body_markdown: string;
  research_notes: { id: string; url: string; title: string }[];
  status: "draft" | "in_review" | "approved" | "scheduled" | "sent";
  scheduled_at: string | null;
  approved_by: string | null;
  sent_at: string | null;
  stats: Record<string, number>;
  created_by: string | null;
  created_at: string;
}

const draftSchema = z.object({ subject: z.string().max(200), bodyMarkdown: z.string().max(30000) });

/** Research a topic and produce an AI-assisted draft with citations. The draft always needs human review. */
export async function draftNewsletter(deps: EngineDeps, orgId: string, userId: string, input: { title: string; topic: string }) {
  const sources = deps.research.hasSearch
    ? await deps.research.search(`${input.topic} mergers acquisitions lower middle market`, { numResults: 6, category: "news", startPublishedDate: new Date(Date.now() - 45 * 864e5).toISOString() })
    : [];
  const draft = await deps.llm.completeJson(
    draftSchema,
    {
      task: "newsletter_draft",
      system: "You are the editor of Tuck Advisors' M&A market newsletter. Write in a measured, insightful tone. Cite sources inline as [n] using the given list order. Do not include any claim not supported by a source unless it is clearly framed as the firm's perspective.",
      user: `Title: ${input.title}\nTopic: ${input.topic}\nSources: ${JSON.stringify(sources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, excerpt: s.excerpt.slice(0, 1200) })))}\nReturn {subject, bodyMarkdown}.`,
    },
    () => ({
      subject: input.title,
      bodyMarkdown: [
        `# ${input.title}`,
        "",
        `_Draft outline on **${input.topic}** — written without an AI provider. Replace with your commentary before review._`,
        "",
        "## Market observations",
        ...(sources.length ? sources.map((s, i) => `- ${s.title} [${i + 1}]`) : ["- (No sources retrieved — configure EXA_API_KEY for automated research.)"]),
        "",
        "## What this means for owners and buyers",
        "- ",
        "",
        "## Sources",
        ...sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`),
      ].join("\n"),
    }),
  );
  return asSystem(
    deps.db,
    async (tx) => {
      const { rows } = await tx.query<NewsletterRow>(
        `insert into public.newsletters (organization_id, title, subject, body_markdown, research_notes, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
        [orgId, input.title, draft.subject, draft.bodyMarkdown, JSON.stringify(sources.map((s) => ({ id: s.id, url: s.url, title: s.title }))), userId],
      );
      return rows[0]!;
    },
    userId,
  );
}

export async function getNewsletter(tx: Queryable, orgId: string, id: string) {
  const { rows } = await tx.query<NewsletterRow>("select * from public.newsletters where organization_id = $1 and id = $2", [orgId, id]);
  if (!rows[0]) throw new NotFoundError("Newsletter");
  return rows[0];
}

export async function updateNewsletter(tx: Queryable, orgId: string, id: string, patch: { title?: string; subject?: string; bodyMarkdown?: string }) {
  const n = await getNewsletter(tx, orgId, id);
  if (!["draft", "in_review"].includes(n.status)) throw new ValidationError("Approved newsletters are locked; create a new draft to make changes");
  await tx.query(
    "update public.newsletters set title = coalesce($3, title), subject = coalesce($4, subject), body_markdown = coalesce($5, body_markdown), status = 'draft', approved_by = null where organization_id = $1 and id = $2",
    [orgId, id, patch.title ?? null, patch.subject ?? null, patch.bodyMarkdown ?? null],
  );
  return getNewsletter(tx, orgId, id);
}

export async function transitionNewsletter(tx: Queryable, orgId: string, userId: string, id: string, action: "submit" | "approve" | "schedule", scheduledAt?: string) {
  const n = await getNewsletter(tx, orgId, id);
  if (action === "submit") {
    if (n.status !== "draft") throw new ValidationError("Only drafts can be submitted");
    if (n.body_markdown.trim().length < 50) throw new ValidationError("Newsletter body is too short to submit");
    await tx.query("update public.newsletters set status = 'in_review' where id = $1", [id]);
  } else if (action === "approve") {
    if (n.status !== "in_review") throw new ValidationError("Newsletter must be in review to approve");
    if (n.created_by === userId) throw new ForbiddenError("A newsletter must be approved by someone other than its author");
    await tx.query("update public.newsletters set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [id, userId]);
  } else {
    if (n.status !== "approved") throw new ValidationError("Only approved newsletters can be scheduled");
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) throw new ValidationError("A valid schedule time is required");
    await tx.query("update public.newsletters set status = 'scheduled', scheduled_at = $2 where id = $1", [id, scheduledAt]);
  }
  return getNewsletter(tx, orgId, id);
}

export function markdownToText(md: string) {
  return md.replace(/^#+\s*/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/_(.*?)_/g, "$1").replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)");
}

/** Worker: deliver scheduled newsletters to subscribed, non-suppressed recipients only. */
export async function sendDueNewsletters(deps: EngineDeps) {
  const due = await asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<NewsletterRow>(
      "update public.newsletters set status = 'sent', sent_at = now() where id in (select id from public.newsletters where status = 'scheduled' and scheduled_at <= now() and approved_by is not null for update skip locked) returning *",
    );
    return rows;
  });
  const results = [];
  for (const n of due) {
    const subs = await asSystem(deps.db, (tx) =>
      tx.query<{ email: string; unsubscribe_token: string }>(
        `select s.email, s.unsubscribe_token from public.newsletter_subscribers s
         where s.organization_id = $1 and s.status = 'subscribed' and s.consent_at is not null
           and not exists (select 1 from public.suppression_list x where x.organization_id = s.organization_id and x.email = s.email)`,
        [n.organization_id],
      ),
    );
    let sent = 0;
    let failed = 0;
    let simulated = 0;
    for (const s of subs.rows) {
      const unsub = `${deps.env.APP_URL ?? "http://localhost:3000"}/unsubscribe?t=${s.unsubscribe_token}`;
      try {
        const r = await deps.email.send({
          from: deps.env.NEWSLETTER_FROM ?? "Tuck Advisors <insights@example.com>",
          to: s.email,
          subject: n.subject,
          text: `${markdownToText(n.body_markdown)}\n\n—\nUnsubscribe: ${unsub}`,
          headers: { "List-Unsubscribe": `<${unsub}>` },
        });
        sent++;
        if (r.status === "simulated") simulated++;
      } catch {
        failed++;
      }
    }
    await asSystem(deps.db, (tx) => tx.query("update public.newsletters set stats = $2 where id = $1", [n.id, JSON.stringify({ recipients: subs.rows.length, sent, failed, simulated })]));
    results.push({ id: n.id, sent, failed, simulated });
  }
  return results;
}
