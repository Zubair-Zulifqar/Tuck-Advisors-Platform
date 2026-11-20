import { createHash } from "node:crypto";
import { APPROVAL_REQUIRED_ACTIONS, type AutomationInput, type TriggerType, automationInput } from "@tuck/shared";
import { type Queryable, asSystem, NotFoundError, ValidationError } from "@tuck/db";
import type { EngineDeps } from "../deps";
import { evaluateConditions, renderParams, triggerMatches } from "./conditions";
import { ACTION_HANDLERS } from "./actions";

export interface DomainEvent {
  type: TriggerType;
  payload: Record<string, unknown>;
  /** Stable id for idempotency (e.g. "company:<id>"). Same automation + same key never runs twice. */
  dedupeKey?: string;
  actorUserId?: string | null;
}

export interface StepRecord {
  id: string;
  type: string;
  status: "succeeded" | "failed" | "skipped" | "waiting" | "awaiting_approval";
  attempt: number;
  output?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  delayed?: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export interface ExecutionRow {
  id: string;
  organization_id: string;
  automation_id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  status: string;
  current_step: number;
  attempts: number;
  steps: StepRecord[];
  error: string | null;
  resume_at: string | null;
  created_at: string;
}

interface AutomationRow {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  definition: AutomationInput;
}

/** Fan an event out to every active automation for this trigger. Conditions decide pending vs skipped. */
export async function dispatchEvent(deps: EngineDeps, orgId: string, event: DomainEvent) {
  return asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<AutomationRow>(
      "select * from public.automations where organization_id = $1 and trigger_type = $2 and status = 'active'",
      [orgId, event.type],
    );
    const created: string[] = [];
    for (const a of rows) {
      const def = automationInput.safeParse(a.definition);
      if (!def.success) continue;
      const ctx = { payload: event.payload, event: { type: event.type } };
      if (!triggerMatches(def.data.trigger.config, event.payload)) continue;
      const cond = evaluateConditions(def.data.conditions, def.data.conditionMode, ctx);
      const baseKey = event.dedupeKey ?? createHash("sha1").update(JSON.stringify(event.payload)).digest("hex");
      const dedupeKey = def.data.dedupeKey ? renderParams({ k: def.data.dedupeKey }, ctx).k as string : `${event.type}:${baseKey}`;
      const res = await tx.query<{ id: string }>(
        `insert into public.automation_executions (organization_id, automation_id, event_type, event_payload, dedupe_key, status, error)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (automation_id, dedupe_key) where dedupe_key is not null do nothing returning id`,
        [
          orgId,
          a.id,
          event.type,
          JSON.stringify(event.payload),
          dedupeKey,
          cond.passed ? "pending" : "skipped",
          cond.passed ? null : `Conditions not met: ${cond.failed.map((c) => `${c.path} ${c.op}`).join(", ")}`,
        ],
      );
      if (res.rows[0] && cond.passed) created.push(res.rows[0].id);
    }
    return created;
  }, event.actorUserId ?? undefined);
}

export async function claimExecutions(deps: EngineDeps, limit = 10) {
  return asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<ExecutionRow>(
      `update public.automation_executions e set status = 'running'
       where e.id in (
         select x.id from public.automation_executions x join public.automations a on a.id = x.automation_id
         where a.status = 'active' and (x.status = 'pending' or (x.status = 'waiting' and x.resume_at <= now()))
         order by x.created_at limit $1 for update of x skip locked)
       returning e.*`,
      [limit],
    );
    return rows;
  });
}

async function save(tx: Queryable, e: ExecutionRow, patch: Partial<ExecutionRow>) {
  Object.assign(e, patch);
  await tx.query(
    `update public.automation_executions set status = $2, current_step = $3, attempts = $4, steps = $5, error = $6, resume_at = $7 where id = $1`,
    [e.id, e.status, e.current_step, e.attempts, JSON.stringify(e.steps), e.error, e.resume_at],
  );
}

/** Advance one execution as far as it can go: runs steps, honours delays, approvals and retry policy. */
export async function runExecution(deps: EngineDeps, exec: ExecutionRow): Promise<ExecutionRow> {
  const automation = await asSystem(deps.db, async (tx) => {
    const { rows } = await tx.query<AutomationRow>("select * from public.automations where id = $1", [exec.automation_id]);
    return rows[0];
  });
  if (!automation) throw new NotFoundError("Automation");
  const def = automationInput.parse(automation.definition);
  const steps = [...(exec.steps ?? [])];
  const ctx = { payload: exec.event_payload, event: { type: exec.event_type }, steps: {} as Record<string, unknown> };
  for (const s of steps) if (s.status === "succeeded") (ctx.steps as Record<string, unknown>)[s.id] = s.output;

  for (let i = exec.current_step; i < def.actions.length; i++) {
    const step = def.actions[i]!;
    const rec: StepRecord = steps[i] ?? { id: step.id, type: step.type, status: "waiting", attempt: 0 };
    steps[i] = rec;

    if (step.delaySeconds > 0 && !rec.delayed) {
      rec.delayed = true;
      rec.status = "waiting";
      await asSystem(deps.db, (tx) => save(tx, exec, { status: "waiting", current_step: i, steps, resume_at: new Date(deps.now().getTime() + step.delaySeconds * 1000).toISOString() }));
      return exec;
    }
    if ((step.requiresApproval || APPROVAL_REQUIRED_ACTIONS.includes(step.type)) && !rec.approvedBy) {
      rec.status = "awaiting_approval";
      await asSystem(deps.db, (tx) => save(tx, exec, { status: "awaiting_approval", current_step: i, steps, resume_at: null }));
      return exec;
    }

    const handler = ACTION_HANDLERS[step.type];
    rec.attempt += 1;
    rec.startedAt = deps.now().toISOString();
    try {
      const output = await handler({ deps, orgId: exec.organization_id, params: renderParams(step.params, ctx), ctx, executionId: exec.id });
      rec.status = "succeeded";
      rec.output = output;
      rec.error = undefined;
      rec.finishedAt = deps.now().toISOString();
      (ctx.steps as Record<string, unknown>)[step.id] = output;
      await asSystem(deps.db, (tx) => save(tx, exec, { status: "running", current_step: i + 1, steps, error: null, resume_at: null }));
    } catch (e) {
      const msg = (e as Error).message.slice(0, 1000);
      rec.error = msg;
      rec.finishedAt = deps.now().toISOString();
      const nonRetryable = e instanceof ValidationError || e instanceof NotFoundError;
      if (!nonRetryable && rec.attempt < def.retry.maxAttempts) {
        rec.status = "waiting";
        const delay = def.retry.backoffSeconds * def.retry.backoffMultiplier ** (rec.attempt - 1);
        await asSystem(deps.db, (tx) =>
          save(tx, exec, { status: "waiting", current_step: i, steps, attempts: exec.attempts + 1, error: msg, resume_at: new Date(deps.now().getTime() + delay * 1000).toISOString() }),
        );
        return exec;
      }
      rec.status = "failed";
      if (step.continueOnError) {
        await asSystem(deps.db, (tx) => save(tx, exec, { current_step: i + 1, steps, error: msg }));
        continue;
      }
      await asSystem(deps.db, (tx) => save(tx, exec, { status: "failed", current_step: i, steps, error: msg, resume_at: null }));
      deps.logger.warn("automation.failed", { executionId: exec.id, step: step.id, error: msg });
      return exec;
    }
  }
  const anyFailed = steps.some((s) => s.status === "failed");
  await asSystem(deps.db, (tx) => save(tx, exec, { status: anyFailed ? "failed" : "succeeded", current_step: def.actions.length, steps, resume_at: null }));
  return exec;
}

export async function runAutomationQueueOnce(deps: EngineDeps, limit = 10) {
  const claimed = await claimExecutions(deps, limit);
  const out: ExecutionRow[] = [];
  for (const e of claimed) {
    try {
      out.push(await runExecution(deps, e));
    } catch (err) {
      await asSystem(deps.db, (tx) => tx.query("update public.automation_executions set status = 'failed', error = $2 where id = $1", [e.id, (err as Error).message]));
    }
  }
  return out;
}

/** Human approval of the step an execution is paused on. Caller must hold automation:approve. */
export async function approveExecution(tx: Queryable, orgId: string, userId: string, executionId: string) {
  const { rows } = await tx.query<ExecutionRow>("select * from public.automation_executions where organization_id = $1 and id = $2 for update", [orgId, executionId]);
  const e = rows[0];
  if (!e) throw new NotFoundError("Execution");
  if (e.status !== "awaiting_approval") throw new ValidationError("Execution is not awaiting approval");
  const steps = [...e.steps];
  const rec = steps[e.current_step];
  if (rec) Object.assign(rec, { approvedBy: userId, approvedAt: new Date().toISOString(), status: "waiting" });
  await tx.query("update public.automation_executions set status = 'pending', steps = $3, approved_by = $4 where organization_id = $1 and id = $2", [orgId, executionId, JSON.stringify(steps), userId]);
}

export async function cancelExecution(tx: Queryable, orgId: string, executionId: string) {
  const { rows } = await tx.query(
    "update public.automation_executions set status = 'cancelled' where organization_id = $1 and id = $2 and status in ('pending','waiting','awaiting_approval','failed') returning id",
    [orgId, executionId],
  );
  if (!rows[0]) throw new ValidationError("Execution cannot be cancelled in its current state");
}

/** Manual retry of a failed execution from the failed step. */
export async function retryExecution(tx: Queryable, orgId: string, executionId: string) {
  const { rows } = await tx.query<ExecutionRow>("select * from public.automation_executions where organization_id = $1 and id = $2", [orgId, executionId]);
  const e = rows[0];
  if (!e) throw new NotFoundError("Execution");
  if (e.status !== "failed") throw new ValidationError("Only failed executions can be retried");
  const steps = e.steps.map((s, i) => (i === e.current_step ? { ...s, attempt: 0, status: "waiting" as const } : s));
  await tx.query("update public.automation_executions set status = 'pending', error = null, steps = $3 where organization_id = $1 and id = $2", [orgId, executionId, JSON.stringify(steps)]);
}
