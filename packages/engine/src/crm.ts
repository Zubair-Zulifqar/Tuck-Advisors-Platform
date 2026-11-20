import { DEFAULT_MATRIX, matrixModelInput } from "@tuck/shared";
import { type Queryable, applyEnrichment, asSystem, createActivity, getCompany, getContact, ValidationError } from "@tuck/db";
import type { EngineDeps } from "./deps";
import { dispatchEvent } from "./automation/runtime";
import { companyRowToFacts } from "./research/heuristics";
import { activeMatrixModel } from "./research/jobs";

/** Enrich one contact through Apollo/RocketReach. Mock mode records "not found" and never invents data. */
export async function enrichContact(deps: EngineDeps, orgId: string, contactId: string, actorUserId: string | null, preferred?: "apollo" | "rocketreach") {
  const { contact, company } = await asSystem(deps.db, async (tx) => {
    const contact = await getContact(tx, orgId, contactId);
    const company = contact.company_id ? await getCompany(tx, orgId, contact.company_id) : null;
    return { contact, company };
  });
  const provider = deps.enrichment(preferred);
  const r = await provider.enrichPerson({
    firstName: contact.first_name,
    lastName: contact.last_name,
    companyName: company?.name,
    companyDomain: company?.domain,
    linkedinUrl: contact.linkedin_url,
  });
  const updated = await asSystem(
    deps.db,
    async (tx) => {
      const c = r.found ? await applyEnrichment(tx, orgId, contactId, { ...r, provider: r.provider }) : await getContact(tx, orgId, contactId);
      await tx.query("update public.contacts set enriched_at = now() where id = $1", [contactId]);
      await createActivity(tx, orgId, actorUserId, {
        type: "enrichment",
        subject: r.mock
          ? "Enrichment skipped — no provider configured (mock)"
          : r.found
            ? `Enriched via ${r.provider}${r.email ? ` · email ${r.emailVerified ? "verified" : "unverified"}` : " · no email returned"}`
            : `No match found via ${r.provider}`,
        contactId,
        companyId: contact.company_id ?? undefined,
        metadata: { provider: r.provider, found: r.found, emailStatusRaw: r.emailStatusRaw, mock: r.mock },
      });
      return c;
    },
    actorUserId ?? undefined,
  );
  if (r.found) await dispatchEvent(deps, orgId, { type: "contact.enriched", payload: { contactId, provider: r.provider, emailVerified: r.emailVerified }, dedupeKey: `enrich:${contactId}:${Date.now()}` });
  return { contact: updated, result: r };
}

/** Score a buyer/target pair from CRM data with the org's active matrix model and persist the result. */
export async function calculateFitScore(deps: EngineDeps, orgId: string, buyerCompanyId: string, targetCompanyId: string, actorUserId: string | null) {
  if (buyerCompanyId === targetCompanyId) throw new ValidationError("Buyer and target must be different companies");
  if (!deps.scoring) throw new ValidationError("Fit Score service is not configured (SCORING_SERVICE_URL)");
  const { buyer, target, model } = await asSystem(deps.db, async (tx) => {
    const buyer = await getCompany(tx, orgId, buyerCompanyId);
    const target = await getCompany(tx, orgId, targetCompanyId);
    let model = await activeMatrixModel(tx, orgId);
    if (!model) model = await ensureDefaultMatrix(tx, orgId, actorUserId);
    return { buyer, target, model };
  });
  const result = await deps.scoring.score(model.model, companyRowToFacts(buyer), companyRowToFacts(target));
  const row = await asSystem(
    deps.db,
    async (tx) => {
      const { rows } = await tx.query<{ id: string; created_at: string }>(
        `insert into public.fit_scores (organization_id, matrix_model_id, buyer_company_id, target_company_id, score, grade, confidence, result)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
        [orgId, model.id, buyerCompanyId, targetCompanyId, result.score, result.grade, result.confidence, JSON.stringify(result)],
      );
      await createActivity(tx, orgId, actorUserId, {
        type: "research",
        subject: `AI Fit Score vs ${buyer.name}: ${result.score === null ? "insufficient data" : `${result.score.toFixed(1)} (${result.grade})`}`,
        companyId: targetCompanyId,
        metadata: { fitScoreId: rows[0]!.id, buyerCompanyId },
      });
      return rows[0]!;
    },
    actorUserId ?? undefined,
  );
  await dispatchEvent(deps, orgId, {
    type: "fit_score.generated",
    payload: { fitScoreId: row.id, buyerCompanyId, targetCompanyId, score: result.score, grade: result.grade },
    dedupeKey: `fit:${row.id}`,
  });
  return { id: row.id, result, matrixModelId: model.id };
}

export async function ensureDefaultMatrix(tx: Queryable, orgId: string, userId: string | null) {
  const def = matrixModelInput.parse(DEFAULT_MATRIX);
  const { rows } = await tx.query<{ id: string; version: number }>(
    `insert into public.matrix_models (organization_id, key, version, name, definition, is_active, created_by)
     values ($1,$2,1,$3,$4,true,$5)
     on conflict (organization_id, key, version) do update set name = excluded.name returning id, version`,
    [orgId, def.key, def.name, JSON.stringify(def), userId],
  );
  return { id: rows[0]!.id, model: { ...def, version: rows[0]!.version } };
}

/** Publish a new matrix version (never mutates old versions, so historical scores stay explainable). */
export async function publishMatrixVersion(tx: Queryable, orgId: string, userId: string, definition: unknown) {
  const def = matrixModelInput.parse(definition);
  const { rows: prev } = await tx.query<{ v: number | null }>("select max(version) as v from public.matrix_models where organization_id = $1 and key = $2", [orgId, def.key]);
  const version = (prev[0]?.v ?? 0) + 1;
  await tx.query("update public.matrix_models set is_active = false where organization_id = $1 and key = $2 and is_active", [orgId, def.key]);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.matrix_models (organization_id, key, version, name, definition, is_active, created_by) values ($1,$2,$3,$4,$5,true,$6) returning id`,
    [orgId, def.key, version, def.name, JSON.stringify(def), userId],
  );
  return { id: rows[0]!.id, version };
}

/** Push a company and its latest fit score to the external CRM, tracking id mappings. */
export async function syncCompanyToExternalCrm(deps: EngineDeps, orgId: string, companyId: string) {
  const crm = deps.externalCrm;
  const { company, mapping, fit } = await asSystem(deps.db, async (tx) => {
    const company = await getCompany(tx, orgId, companyId);
    const m = await tx.query<{ external_id: string }>(
      "select external_id from public.external_crm_mappings where organization_id = $1 and provider = $2 and entity_type = 'company' and local_id = $3",
      [orgId, crm.name, companyId],
    );
    const f = await tx.query<{ id: string; score: string | null; grade: string; result: { explanation: string[] } }>(
      "select id, score, grade, result from public.fit_scores where organization_id = $1 and target_company_id = $2 order by created_at desc limit 1",
      [orgId, companyId],
    );
    return { company, mapping: m.rows[0]?.external_id ?? null, fit: f.rows[0] ?? null };
  });
  const { externalId } = await crm.upsertCompany({ name: company.name, website: company.website, description: company.description }, mapping);
  let fitSynced = false;
  if (fit) {
    await crm.writeFitScore(externalId, { value: fit.score === null ? null : Number(fit.score), grade: fit.grade, summary: fit.result.explanation.slice(0, 3).join(" ") });
    fitSynced = true;
  }
  await asSystem(deps.db, async (tx) => {
    await tx.query(
      `insert into public.external_crm_mappings (organization_id, provider, entity_type, local_id, external_id) values ($1,$2,'company',$3,$4)
       on conflict (organization_id, provider, entity_type, local_id) do update set external_id = excluded.external_id, last_synced_at = now()`,
      [orgId, crm.name, companyId, externalId],
    );
    if (fit) await tx.query("update public.fit_scores set synced_to_crm_at = now() where id = $1", [fit.id]);
  });
  return { externalId, provider: crm.name, mock: crm.mock, fitSynced };
}
