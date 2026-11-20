import { RESEARCH_KINDS, type ResearchKind, type ResearchSource, DEFAULT_MATRIX, matrixModelInput } from "@tuck/shared";
import { type Queryable, asSystem, createActivity, createTask, getCompany, getContact, listActivities, NotFoundError, ValidationError } from "@tuck/db";
import type { EngineDeps } from "../deps";
import { dispatchEvent } from "../automation/runtime";
import {
  buildCompanyProfile,
  detectCapitalRaise,
  discoverBuyers,
  discoverSimilarCompanies,
  gatherCompanySources,
  positioningStatement,
  postCallNotes,
  preCallNotes,
} from "./engine";
import { companyRowToFacts } from "./heuristics";

export interface ResearchJobRow {
  id: string;
  organization_id: string;
  kind: ResearchKind;
  status: string;
  input: Record<string, unknown>;
  company_id: string | null;
  contact_id: string | null;
  attempts: number;
  requested_by: string | null;
  last_error: string | null;
  report_id: string | null;
  created_at: string;
}

export async function enqueueResearch(
  tx: Queryable,
  orgId: string,
  userId: string | null,
  job: { kind: ResearchKind; companyId?: string | null; contactId?: string | null; input?: Record<string, unknown>; runAfter?: Date },
) {
  if (!RESEARCH_KINDS.includes(job.kind)) throw new ValidationError(`Unknown research kind ${job.kind}`);
  const needsCompany: ResearchKind[] = ["business_overview", "positioning_statement", "capital_raise", "acquisition_analysis", "similar_companies", "buyer_classification", "pre_call_notes"];
  if (needsCompany.includes(job.kind) && !job.companyId && !job.contactId) throw new ValidationError("This research type requires a company");
  if (job.kind === "post_call_notes" && typeof job.input?.transcript !== "string") throw new ValidationError("Post-call notes require meeting notes or a transcript");
  if (job.companyId) await getCompany(tx, orgId, job.companyId);
  if (job.contactId) await getContact(tx, orgId, job.contactId);
  const { rows } = await tx.query<ResearchJobRow>(
    `insert into public.research_jobs (organization_id, kind, input, company_id, contact_id, requested_by, run_after)
     values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now())) returning *`,
    [orgId, job.kind, JSON.stringify(job.input ?? {}), job.companyId ?? null, job.contactId ?? null, userId, job.runAfter?.toISOString() ?? null],
  );
  return rows[0]!;
}

/** Atomically claims queued jobs (FOR UPDATE SKIP LOCKED) so multiple workers can run safely. */
export async function claimResearchJobs(deps: EngineDeps, limit = 5) {
  return asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<ResearchJobRow>(
      `update public.research_jobs j set status = 'running', started_at = now(), attempts = attempts + 1
       where j.id in (select id from public.research_jobs where status = 'queued' and run_after <= now() order by run_after limit $1 for update skip locked)
       returning j.*`,
      [limit],
    );
    return rows;
  });
}

interface ReportDraft {
  title: string;
  content: unknown;
  sources: ResearchSource[];
  needsReview?: boolean;
  companyId?: string | null;
  contactId?: string | null;
}

async function execute(deps: EngineDeps, job: ResearchJobRow): Promise<ReportDraft> {
  const org = job.organization_id;
  const load = async () =>
    asSystem(deps.db, async (tx) => {
      const contact = job.contact_id ? await getContact(tx, org, job.contact_id) : null;
      const companyId = job.company_id ?? contact?.company_id ?? null;
      const company = companyId ? await getCompany(tx, org, companyId) : null;
      return { company, contact };
    });
  const { company, contact } = await load();
  const website = company?.website ?? (company?.domain ? `https://${company.domain}` : null);

  switch (job.kind) {
    case "business_overview": {
      if (!company || !website) throw new ValidationError("Company needs a website or domain for research");
      const sources = await gatherCompanySources(deps, website, company.name);
      const profile = await buildCompanyProfile(deps, website, sources, company.name);
      return { title: `Business overview — ${company.name}`, content: profile, sources };
    }
    case "positioning_statement": {
      if (!company || !website) throw new ValidationError("Company needs a website or domain for research");
      const sources = await gatherCompanySources(deps, website, company.name);
      const profile = await buildCompanyProfile(deps, website, sources, company.name);
      return { title: `Positioning statement — ${company.name}`, content: await positioningStatement(deps, profile, sources), sources };
    }
    case "capital_raise": {
      if (!company) throw new NotFoundError("Company");
      const r = await detectCapitalRaise(deps, company.name, company.domain);
      return { title: `Capital raise screen — ${company.name}`, content: { signals: r.signals, summary: r.summary }, sources: r.sources, needsReview: r.signals.length > 0 };
    }
    case "similar_companies":
    case "acquisition_analysis": {
      if (!company || !website) throw new ValidationError("Company needs a website or domain for research");
      const similar = await discoverSimilarCompanies(deps, website);
      let buyers: Awaited<ReturnType<typeof discoverBuyers>> | null = null;
      let sources: ResearchSource[] = similar.sources ?? [];
      if (job.kind === "acquisition_analysis") {
        const s = await gatherCompanySources(deps, website, company.name);
        const profile = await buildCompanyProfile(deps, website, s, company.name);
        buyers = await discoverBuyers(deps, profile);
        sources = [...s, ...sources, ...buyers.sources];
        return { title: `Acquisition analysis — ${company.name}`, content: { profile, similarCompanies: similar.companies, buyerCandidates: buyers.candidates, notes: [similar.note, buyers.note].filter(Boolean) }, sources, needsReview: true };
      }
      return { title: `Similar companies — ${company.name}`, content: { companies: similar.companies, note: similar.note }, sources };
    }
    case "pre_call_notes": {
      if (!company) throw new NotFoundError("Company");
      const history = await asSystem(deps.db, (tx) => listActivities(tx, org, contact ? { contactId: contact.id, limit: 25 } : { companyId: company.id, limit: 25 }));
      const sources = website ? await gatherCompanySources(deps, website, company.name).catch(() => []) : [];
      const content = await preCallNotes(deps, {
        company,
        contact: contact ? { name: `${contact.first_name} ${contact.last_name ?? ""}`.trim(), title: contact.title } : null,
        history,
        sources,
      });
      return { title: `Pre-call brief — ${contact ? `${contact.first_name} ${contact.last_name ?? ""} · ` : ""}${company.name}`, content, sources, contactId: contact?.id };
    }
    case "post_call_notes": {
      const transcript = String(job.input.transcript ?? "");
      const content = await postCallNotes(deps, transcript, { companyName: company?.name });
      await asSystem(
        deps.db,
        async (tx) => {
          await createActivity(tx, org, job.requested_by, {
            type: "meeting",
            subject: `Meeting notes${company ? ` — ${company.name}` : ""}`,
            body: content.summary,
            companyId: company?.id,
            contactId: contact?.id,
            metadata: { source: "post_call_notes", jobId: job.id },
          });
          for (const a of content.actionItems)
            await createTask(tx, org, job.requested_by, {
              title: a.title,
              companyId: company?.id,
              contactId: contact?.id,
              dueAt: a.dueInDays !== undefined ? new Date(deps.now().getTime() + a.dueInDays * 864e5).toISOString() : undefined,
              source: "post_call_notes",
            });
        },
        job.requested_by ?? undefined,
      );
      return { title: `Post-call notes${company ? ` — ${company.name}` : ""}`, content, sources: [], needsReview: content.crmUpdates.length > 0 };
    }
    case "buyer_classification": {
      if (!company) throw new NotFoundError("Company");
      if (!deps.scoring) throw new ValidationError("Buyer classification requires the scoring service (SCORING_SERVICE_URL)");
      const rules = await asSystem(deps.db, (tx) =>
        tx.query<{ id: string; bucket: string; priority: number; rule: unknown }>("select * from public.buyer_bucket_rules where organization_id = $1 order by priority", [org]),
      );
      const result = await deps.scoring.classifyBuyer(
        rules.rows.map((r) => ({ key: r.id, bucket: r.bucket, priority: r.priority, conditions: r.rule as never })),
        companyRowToFacts(company),
      );
      await asSystem(deps.db, (tx) =>
        tx.query(
          `insert into public.buyers (organization_id, company_id, bucket, bucket_explanation) values ($1,$2,$3,$4)
           on conflict (organization_id, company_id) do update set bucket = excluded.bucket, bucket_explanation = excluded.bucket_explanation`,
          [org, company.id, result.bucket, JSON.stringify(result.explanation)],
        ),
      );
      return { title: `Buyer classification — ${company.name}`, content: result, sources: [] };
    }
    case "reddit_signals":
    case "ma_analyzer":
      throw new ValidationError(`${job.kind} runs through its dedicated module, not the research queue`);
  }
}

export async function processResearchJob(deps: EngineDeps, job: ResearchJobRow) {
  try {
    const draft = await execute(deps, job);
    const reportId = await asSystem(
      deps.db,
      async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `insert into public.research_reports (organization_id, kind, title, company_id, contact_id, content, sources, providers, needs_review, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [
            job.organization_id,
            job.kind,
            draft.title,
            job.company_id ?? draft.companyId ?? null,
            job.contact_id ?? draft.contactId ?? null,
            JSON.stringify(draft.content),
            JSON.stringify(draft.sources),
            JSON.stringify({ llm: deps.llm.name, research: deps.research.name, mock: deps.llm.mock }),
            draft.needsReview ?? false,
            job.requested_by,
          ],
        );
        const id = rows[0]!.id;
        await tx.query("update public.research_jobs set status = 'succeeded', finished_at = now(), report_id = $2, last_error = null where id = $1", [job.id, id]);
        if (job.company_id)
          await createActivity(tx, job.organization_id, job.requested_by, { type: "research", subject: draft.title, companyId: job.company_id, contactId: job.contact_id ?? undefined, metadata: { reportId: id, kind: job.kind } });
        return id;
      },
      job.requested_by ?? undefined,
    );
    await dispatchEvent(deps, job.organization_id, {
      type: "research.completed",
      payload: { jobId: job.id, reportId, kind: job.kind, companyId: job.company_id, contactId: job.contact_id },
      dedupeKey: `research:${job.id}`,
    });
    return { ok: true as const, reportId };
  } catch (e) {
    const err = e as Error & { retryable?: boolean };
    const retry = err.retryable === true && job.attempts < 3;
    await asSystem(deps.db, (tx) =>
      tx.query(
        `update public.research_jobs set status = $2, last_error = $3, finished_at = case when $2 = 'failed' then now() else null end,
           run_after = now() + make_interval(secs => $4) where id = $1`,
        [job.id, retry ? "queued" : "failed", err.message.slice(0, 1000), 30 * 2 ** job.attempts],
      ),
    );
    deps.logger.warn("research.job_failed", { jobId: job.id, kind: job.kind, error: err.message, retry });
    return { ok: false as const, error: err.message, retry };
  }
}

export async function runResearchQueueOnce(deps: EngineDeps, limit = 5) {
  const jobs = await claimResearchJobs(deps, limit);
  const results = [];
  for (const j of jobs) results.push(await processResearchJob(deps, j));
  return results;
}

/** Active matrix model for an org (falls back to the built-in default, version 0). */
export async function activeMatrixModel(tx: Queryable, orgId: string, key = DEFAULT_MATRIX.key) {
  const { rows } = await tx.query<{ id: string; version: number; definition: unknown }>(
    "select id, version, definition from public.matrix_models where organization_id = $1 and key = $2 and is_active",
    [orgId, key],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, model: { ...matrixModelInput.parse(rows[0].definition), version: rows[0].version } };
}
