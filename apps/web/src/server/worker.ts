import "server-only";
import { asSystem, claimDueFollowUps } from "@tuck/db";
import { dispatchEvent, runAutomationQueueOnce, runResearchQueueOnce, sendCampaignBatch, sendDueNewsletters, type EngineDeps } from "@tuck/engine";

let started = false;
let lastRetention = 0;

/** One pass over every queue. Used by the inline dev worker, apps/workers and the /api/internal/cron endpoint. */
export async function runAllQueues(deps: EngineDeps) {
  const research = await runResearchQueueOnce(deps, 3);
  const followUps = await asSystem(deps.db, (tx) => claimDueFollowUps(tx, 25));
  for (const t of followUps)
    await dispatchEvent(deps, (t as { organization_id: string }).organization_id, {
      type: "task.follow_up_due",
      payload: { taskId: t.id, title: t.title, assigneeUserId: t.assignee_user_id, companyId: t.company_id, contactId: t.contact_id },
      dedupeKey: `task:${t.id}`,
    });
  const automations = await runAutomationQueueOnce(deps, 10);
  const outreach = await sendCampaignBatch(deps);
  const newsletters = await sendDueNewsletters(deps);
  // Daily retention: expired analyses, purged soft-deletes, stale tokens, old audit rows.
  if (Date.now() - lastRetention > 24 * 3600_000) {
    lastRetention = Date.now();
    await asSystem(deps.db, (tx) => tx.query("select public.purge_expired_data()"));
  }
  return { research: research.length, followUps: followUps.length, automations: automations.length, outreach: outreach.length, newsletters: newsletters.length };
}

export function startInlineWorker(deps: EngineDeps, intervalMs = 4000) {
  if (started || process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build") return;
  started = true;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runAllQueues(deps);
    } catch (e) {
      deps.logger.error("inline_worker.error", { error: (e as Error).message });
    } finally {
      running = false;
    }
  }, intervalMs).unref?.();
}
