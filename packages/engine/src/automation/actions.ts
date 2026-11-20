import { type ActionType, type ResearchKind, RESEARCH_KINDS, isPublicHttpUrl } from "@tuck/shared";
import { asSystem, createActivity, createTask, updateCompany, updateContact, ValidationError } from "@tuck/db";
import { httpJson, signWebhook } from "@tuck/integrations";
import type { EngineDeps } from "../deps";
import { calculateFitScore, enrichContact } from "../crm";
import { enqueueResearch } from "../research/jobs";

export interface ActionContext {
  deps: EngineDeps;
  orgId: string;
  params: Record<string, unknown>;
  ctx: { payload: Record<string, unknown>; event: { type: string }; steps: Record<string, unknown> };
  executionId: string;
}
type Handler = (a: ActionContext) => Promise<unknown>;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const companyIdOf = (a: ActionContext) => str(a.params.companyId) ?? str(a.ctx.payload.companyId) ?? str(a.ctx.payload.targetCompanyId);
const contactIdOf = (a: ActionContext) => str(a.params.contactId) ?? str(a.ctx.payload.contactId);

const research =
  (kind: ResearchKind): Handler =>
  async (a) => {
    const companyId = companyIdOf(a);
    const job = await asSystem(a.deps.db, (tx) =>
      enqueueResearch(tx, a.orgId, null, { kind, companyId, contactId: contactIdOf(a), input: { automationExecutionId: a.executionId } }),
    );
    return { jobId: job.id, kind };
  };

const ALLOWED_COMPANY_FIELDS = ["industry", "kind", "description", "headquarters", "employeeRange"] as const;
const ALLOWED_CONTACT_FIELDS = ["title"] as const;

export const ACTION_HANDLERS: Record<ActionType, Handler> = {
  "research.business_overview": research("business_overview"),
  "research.positioning_statement": research("positioning_statement"),
  "buyer.classify": research("buyer_classification"),

  "research.report": async (a) => {
    const kind = str(a.params.kind) as ResearchKind | undefined;
    if (!kind || !RESEARCH_KINDS.includes(kind)) throw new ValidationError("research.report requires params.kind");
    return research(kind)(a);
  },

  "research.schedule": async (a) => {
    const kind = str(a.params.kind) as ResearchKind | undefined;
    if (!kind || !RESEARCH_KINDS.includes(kind)) throw new ValidationError("research.schedule requires params.kind");
    const inDays = Math.max(0, Number(a.params.inDays ?? 0));
    const job = await asSystem(a.deps.db, (tx) =>
      enqueueResearch(tx, a.orgId, null, { kind, companyId: companyIdOf(a), contactId: contactIdOf(a), runAfter: new Date(a.deps.now().getTime() + inDays * 864e5) }),
    );
    return { jobId: job.id, runsInDays: inDays };
  },

  "contact.enrich": async (a) => {
    const id = contactIdOf(a);
    if (!id) throw new ValidationError("contact.enrich requires a contactId");
    const r = await enrichContact(a.deps, a.orgId, id, null, str(a.params.provider) as "apollo" | "rocketreach" | undefined);
    return { found: r.result.found, provider: r.result.provider, emailVerified: r.result.emailVerified };
  },

  "fit_score.calculate": async (a) => {
    const buyer = str(a.params.buyerCompanyId) ?? str(a.ctx.payload.buyerCompanyId);
    const target = str(a.params.targetCompanyId) ?? companyIdOf(a);
    if (!buyer || !target) throw new ValidationError("fit_score.calculate needs buyerCompanyId and targetCompanyId");
    const r = await calculateFitScore(a.deps, a.orgId, buyer, target, null);
    return { fitScoreId: r.id, score: r.result.score, grade: r.result.grade };
  },

  "crm.update_fields": async (a) => {
    const entity = a.params.entity === "contact" ? "contact" : "company";
    const fields = (a.params.fields ?? {}) as Record<string, unknown>;
    const allowed: readonly string[] = entity === "company" ? ALLOWED_COMPANY_FIELDS : ALLOWED_CONTACT_FIELDS;
    const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
    const addTags = Array.isArray(a.params.addTags) ? (a.params.addTags as string[]).map(String).slice(0, 10) : [];
    return asSystem(a.deps.db, async (tx) => {
      if (entity === "company") {
        const id = companyIdOf(a);
        if (!id) throw new ValidationError("crm.update_fields requires a companyId");
        if (addTags.length) await tx.query("update public.companies set tags = (select array(select distinct unnest(tags || $3::text[]))) where organization_id = $1 and id = $2", [a.orgId, id, addTags]);
        if (Object.keys(patch).length) await updateCompany(tx, a.orgId, id, patch);
        return { entity, id, updated: Object.keys(patch), addTags };
      }
      const id = contactIdOf(a);
      if (!id) throw new ValidationError("crm.update_fields requires a contactId");
      if (addTags.length) await tx.query("update public.contacts set tags = (select array(select distinct unnest(tags || $3::text[]))) where organization_id = $1 and id = $2", [a.orgId, id, addTags]);
      if (Object.keys(patch).length) await updateContact(tx, a.orgId, id, patch);
      return { entity, id, updated: Object.keys(patch), addTags };
    });
  },

  "task.create": async (a) => {
    const title = str(a.params.title);
    if (!title) throw new ValidationError("task.create requires params.title");
    const dueInDays = Number(a.params.dueInDays ?? 0);
    const t = await asSystem(a.deps.db, (tx) =>
      createTask(tx, a.orgId, null, {
        title: title.slice(0, 300),
        companyId: companyIdOf(a),
        contactId: contactIdOf(a),
        dealId: str(a.ctx.payload.dealId),
        assigneeUserId: str(a.params.assigneeUserId),
        dueAt: new Date(a.deps.now().getTime() + dueInDays * 864e5).toISOString(),
        source: "automation",
      }),
    );
    return { taskId: t.id };
  },

  /** Creates an email DRAFT on the timeline for a human to review and send. Never sends. */
  "email.prepare_draft": async (a) => {
    const subject = str(a.params.subject) ?? "Follow-up";
    const body = str(a.params.body) ?? "";
    const act = await asSystem(a.deps.db, (tx) =>
      createActivity(tx, a.orgId, null, {
        type: "email",
        subject: `[Draft] ${subject}`.slice(0, 300),
        body,
        contactId: contactIdOf(a),
        companyId: companyIdOf(a),
        metadata: { draft: true, requiresHumanSend: true, automationExecutionId: a.executionId },
      }),
    );
    return { draftActivityId: act?.id ?? null };
  },

  "notify.member": async (a) => {
    const message = str(a.params.message) ?? `Automation event: ${a.ctx.event.type}`;
    const userId = str(a.params.userId);
    return asSystem(a.deps.db, async (tx) => {
      const act = await createActivity(tx, a.orgId, null, { type: "system", subject: message.slice(0, 300), companyId: companyIdOf(a), contactId: contactIdOf(a), metadata: { notify: userId ?? "team" } });
      if (userId) await createTask(tx, a.orgId, null, { title: `🔔 ${message}`.slice(0, 300), assigneeUserId: userId, companyId: companyIdOf(a), source: "notification" });
      return { activityId: act?.id };
    });
  },

  /** Zapier / Apps Script compatible outbound webhook, HMAC-signed. Always gated by human approval. */
  "webhook.post": async (a) => {
    const url = str(a.params.url);
    if (!url || !url.startsWith("https://") || !isPublicHttpUrl(url)) throw new ValidationError("webhook.post requires a public https URL");
    const secret = a.deps.env.WEBHOOK_SIGNING_SECRET;
    if (!secret) throw new ValidationError("WEBHOOK_SIGNING_SECRET is not configured");
    const body = JSON.stringify({ event: a.ctx.event.type, payload: a.ctx.payload, executionId: a.executionId, sentAt: a.deps.now().toISOString() });
    await httpJson(url, { provider: "webhook", method: "POST", headers: { "x-tuck-signature": signWebhook(secret, body) }, body: JSON.parse(body), retry: { maxAttempts: 1 } });
    return { delivered: true, url: new URL(url).host };
  },
};
