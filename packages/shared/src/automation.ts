import { z } from "zod";

export const TRIGGERS = [
  "company.created",
  "contact.created",
  "research.completed",
  "fit_score.generated",
  "contact.enriched",
  "deal.stage_changed",
  "outreach.reply_received",
  "meeting.completed",
  "task.follow_up_due",
  "target.discovered",
  "schedule.cron",
  "webhook.received",
] as const;
export type TriggerType = (typeof TRIGGERS)[number];

export const ACTIONS = [
  "research.business_overview",
  "research.positioning_statement",
  "contact.enrich",
  "buyer.classify",
  "fit_score.calculate",
  "research.report",
  "crm.update_fields",
  "task.create",
  "email.prepare_draft",
  "notify.member",
  "research.schedule",
  "webhook.post",
] as const;
export type ActionType = (typeof ACTIONS)[number];

/**
 * Actions that send data outside the platform always pause for explicit human approval.
 * (email.prepare_draft only creates a draft for a human to review — it never sends.)
 */
export const APPROVAL_REQUIRED_ACTIONS: readonly ActionType[] = ["webhook.post"];

export const conditionSchema = z.object({
  path: z.string().max(120).regex(/^[a-zA-Z0-9_.]+$/),
  op: z.enum(["eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "exists", "not_exists"]),
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const actionStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(40),
  type: z.enum(ACTIONS),
  params: z.record(z.unknown()).default({}),
  delaySeconds: z.number().int().min(0).max(60 * 60 * 24 * 30).default(0),
  requiresApproval: z.boolean().default(false),
  continueOnError: z.boolean().default(false),
});
export type ActionStep = z.infer<typeof actionStepSchema>;

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  backoffSeconds: z.number().int().min(1).max(3600).default(30),
  backoffMultiplier: z.number().min(1).max(10).default(2),
});

export const automationInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(""),
  trigger: z.object({ type: z.enum(TRIGGERS), config: z.record(z.unknown()).default({}) }),
  conditions: z.array(conditionSchema).max(20).default([]),
  conditionMode: z.enum(["all", "any"]).default("all"),
  actions: z.array(actionStepSchema).min(1).max(20),
  retry: retryPolicySchema.default({}),
  dedupeKey: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
});
export type AutomationInput = z.infer<typeof automationInput>;
