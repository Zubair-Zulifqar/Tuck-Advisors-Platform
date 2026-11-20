import { DEAL_STAGES, type ActivityInput, type DealInput, type DealStage, type TaskInput } from "@tuck/shared";
import type { Queryable } from "../driver";
import { NotFoundError, ValidationError, buildSet, clampLimit } from "./util";

// ------------------------------------------------------------------ deals
export interface DealRow {
  id: string;
  organization_id: string;
  name: string;
  target_company_id: string | null;
  buyer_company_id: string | null;
  target_name?: string | null;
  buyer_name?: string | null;
  side: string;
  stage: DealStage;
  estimated_value_usd: string | null;
  owner_user_id: string | null;
  notes: string | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
}

const DEAL_SELECT = `select d.*, t.name as target_name, b.name as buyer_name from public.deals d
  left join public.companies t on t.id = d.target_company_id
  left join public.companies b on b.id = d.buyer_company_id`;

export async function listDeals(tx: Queryable, orgId: string, f: { stage?: string; companyId?: string } = {}) {
  const params: unknown[] = [orgId];
  const where = ["d.organization_id = $1"];
  if (f.stage) {
    params.push(f.stage);
    where.push(`d.stage = $${params.length}`);
  }
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`(d.target_company_id = $${params.length} or d.buyer_company_id = $${params.length})`);
  }
  const { rows } = await tx.query<DealRow>(`${DEAL_SELECT} where ${where.join(" and ")} order by d.updated_at desc limit 500`, params);
  return rows;
}

export async function getDeal(tx: Queryable, orgId: string, id: string) {
  const { rows } = await tx.query<DealRow>(`${DEAL_SELECT} where d.organization_id = $1 and d.id = $2`, [orgId, id]);
  if (!rows[0]) throw new NotFoundError("Deal");
  return rows[0];
}

async function assertCompaniesInOrg(tx: Queryable, orgId: string, ids: (string | undefined | null)[]) {
  const wanted = ids.filter(Boolean) as string[];
  if (!wanted.length) return;
  const { rows } = await tx.query<{ id: string }>(
    "select id from public.companies where organization_id = $1 and id = any($2::uuid[]) and deleted_at is null",
    [orgId, wanted],
  );
  if (rows.length !== new Set(wanted).size) throw new NotFoundError("Company");
}

export async function createDeal(tx: Queryable, orgId: string, userId: string | null, input: DealInput) {
  await assertCompaniesInOrg(tx, orgId, [input.targetCompanyId, input.buyerCompanyId]);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.deals (organization_id, name, target_company_id, buyer_company_id, side, stage, estimated_value_usd, owner_user_id, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [
      orgId,
      input.name,
      input.targetCompanyId ?? null,
      input.buyerCompanyId ?? null,
      input.side ?? "sell_side",
      input.stage ?? "sourced",
      input.estimatedValueUsd ?? null,
      input.ownerUserId ?? userId,
      input.notes ?? null,
    ],
  );
  return getDeal(tx, orgId, rows[0]!.id);
}

export async function changeDealStage(tx: Queryable, orgId: string, userId: string | null, id: string, stage: DealStage) {
  if (!DEAL_STAGES.includes(stage)) throw new ValidationError("Unknown deal stage");
  const before = await getDeal(tx, orgId, id);
  if (before.stage === stage) return { deal: before, changed: false, from: stage };
  await tx.query("update public.deals set stage = $3, stage_changed_at = now() where organization_id = $1 and id = $2", [orgId, id, stage]);
  await createActivity(tx, orgId, userId, {
    type: "stage_change",
    subject: `Stage changed: ${before.stage} → ${stage}`,
    dealId: id,
    companyId: before.target_company_id ?? undefined,
    metadata: { from: before.stage, to: stage },
  });
  return { deal: await getDeal(tx, orgId, id), changed: true, from: before.stage };
}

export async function updateDeal(tx: Queryable, orgId: string, id: string, patch: Partial<DealInput>) {
  await assertCompaniesInOrg(tx, orgId, [patch.targetCompanyId, patch.buyerCompanyId]);
  const params: unknown[] = [orgId, id];
  const sets = buildSet(
    patch as Record<string, unknown>,
    {
      name: "name",
      targetCompanyId: "target_company_id",
      buyerCompanyId: "buyer_company_id",
      side: "side",
      estimatedValueUsd: "estimated_value_usd",
      ownerUserId: "owner_user_id",
      notes: "notes",
    },
    params,
  );
  if (sets.length) await tx.query(`update public.deals set ${sets.join(", ")} where organization_id = $1 and id = $2`, params);
  return getDeal(tx, orgId, id);
}

// ------------------------------------------------------------------ activities
export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  actor_user_id: string | null;
  actor_name?: string | null;
  external_ref: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export async function createActivity(
  tx: Queryable,
  orgId: string,
  userId: string | null,
  input: Partial<ActivityInput> & Pick<ActivityInput, "type" | "subject"> & { externalRef?: string },
) {
  const { rows } = await tx.query<ActivityRow>(
    `insert into public.activities (organization_id, type, subject, body, company_id, contact_id, deal_id, actor_user_id, external_ref, metadata, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, coalesce($11::timestamptz, now()))
     on conflict (organization_id, type, external_ref) where external_ref is not null do nothing
     returning *`,
    [
      orgId,
      input.type,
      input.subject,
      input.body ?? null,
      input.companyId ?? null,
      input.contactId ?? null,
      input.dealId ?? null,
      userId,
      input.externalRef ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt ?? null,
    ],
  );
  return rows[0] ?? null; // null => already logged (idempotent)
}

export async function listActivities(
  tx: Queryable,
  orgId: string,
  f: { companyId?: string; contactId?: string; dealId?: string; type?: string; limit?: number } = {},
) {
  const params: unknown[] = [orgId];
  const where = ["a.organization_id = $1"];
  for (const [k, col] of [
    ["companyId", "company_id"],
    ["contactId", "contact_id"],
    ["dealId", "deal_id"],
    ["type", "type"],
  ] as const) {
    if (f[k]) {
      params.push(f[k]);
      where.push(`a.${col} = $${params.length}`);
    }
  }
  params.push(clampLimit(f.limit, 50, 500));
  const { rows } = await tx.query<ActivityRow>(
    `select a.*, u.name as actor_name from public.activities a left join public.users u on u.id = a.actor_user_id
     where ${where.join(" and ")} order by a.occurred_at desc limit $${params.length}`,
    params,
  );
  return rows;
}

// ------------------------------------------------------------------ tasks
export interface TaskRow {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  due_at: string | null;
  company_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  assignee_user_id: string | null;
  source: string;
  created_at: string;
  completed_at: string | null;
}

export async function createTask(tx: Queryable, orgId: string, userId: string | null, input: TaskInput & { source?: string }) {
  const { rows } = await tx.query<TaskRow>(
    `insert into public.tasks (organization_id, title, due_at, company_id, contact_id, deal_id, assignee_user_id, created_by, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [
      orgId,
      input.title,
      input.dueAt ?? null,
      input.companyId ?? null,
      input.contactId ?? null,
      input.dealId ?? null,
      input.assigneeUserId ?? userId,
      userId,
      input.source ?? "manual",
    ],
  );
  return rows[0]!;
}

export async function listTasks(tx: Queryable, orgId: string, f: { status?: string; assignee?: string; companyId?: string; contactId?: string } = {}) {
  const params: unknown[] = [orgId];
  const where = ["organization_id = $1"];
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}`);
  }
  if (f.assignee) {
    params.push(f.assignee);
    where.push(`assignee_user_id = $${params.length}`);
  }
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`company_id = $${params.length}`);
  }
  if (f.contactId) {
    params.push(f.contactId);
    where.push(`contact_id = $${params.length}`);
  }
  const { rows } = await tx.query<TaskRow>(
    `select * from public.tasks where ${where.join(" and ")} order by (status = 'open') desc, due_at asc nulls last limit 300`,
    params,
  );
  return rows;
}

export async function setTaskStatus(tx: Queryable, orgId: string, id: string, status: TaskRow["status"]) {
  const { rows } = await tx.query<TaskRow>(
    `update public.tasks set status = $3, completed_at = case when $3 = 'done' then now() else null end
     where organization_id = $1 and id = $2 returning *`,
    [orgId, id, status],
  );
  if (!rows[0]) throw new NotFoundError("Task");
  return rows[0];
}

/** Atomically claims open, overdue tasks whose follow-up event has not fired yet (exactly-once per task). */
export async function claimDueFollowUps(tx: Queryable, limit = 50) {
  const { rows } = await tx.query<TaskRow & { organization_id: string }>(
    `update public.tasks set follow_up_notified_at = now()
     where id in (select id from public.tasks where status = 'open' and due_at <= now() and follow_up_notified_at is null order by due_at limit $1 for update skip locked)
     returning *`,
    [limit],
  );
  return rows;
}
