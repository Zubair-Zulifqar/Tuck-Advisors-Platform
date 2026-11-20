import { asSystem, claimDueFollowUps } from "@tuck/db";
import { dispatchEvent, runAutomationQueueOnce, runResearchQueueOnce, sendCampaignBatch, sendDueNewsletters, type EngineDeps } from "@tuck/engine";

/** One pass over every Postgres-backed queue. Safe to run on many workers (FOR UPDATE SKIP LOCKED). */
export async function runAllQueues(deps: EngineDeps) {
  const research = await runResearchQueueOnce(deps, 5);
  const followUps = await asSystem(deps.db, (tx) => claimDueFollowUps(tx, 50));
  for (const t of followUps)
    await dispatchEvent(deps, t.organization_id, {
      type: "task.follow_up_due",
      payload: { taskId: t.id, title: t.title, assigneeUserId: t.assignee_user_id, companyId: t.company_id, contactId: t.contact_id },
      dedupeKey: `task:${t.id}`,
    });
  const automations = await runAutomationQueueOnce(deps, 25);
  const outreach = await sendCampaignBatch(deps);
  const newsletters = await sendDueNewsletters(deps);
  return { research: research.length, followUps: followUps.length, automations: automations.length, outreach: outreach.length, newsletters: newsletters.length };
}

/** Daily retention job (deletes expired analyses, purged soft-deletes, stale tokens, old audit rows). */
export async function runRetention(deps: EngineDeps) {
  const { rows } = await asSystem(deps.db, (tx) => tx.query<{ r: unknown }>("select public.purge_expired_data() as r"));
  return rows[0]?.r;
}
