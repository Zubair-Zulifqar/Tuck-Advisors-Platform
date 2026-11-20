import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const COMPANY_KINDS = ["prospect", "buyer", "target", "client", "other"] as const;
export const DEAL_STAGES = [
  "sourced",
  "qualified",
  "engaged",
  "nda",
  "diligence",
  "loi",
  "closing",
  "won",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const VERIFICATION_STATUS = ["unverified", "provider_verified", "manually_verified", "invalid"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];

export const companyInput = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a bare domain like example.com")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  website: optionalUrl,
  linkedinUrl: optionalUrl,
  industry: z.string().trim().max(120).optional(),
  kind: z.enum(COMPANY_KINDS).default("prospect"),
  headquarters: z.string().trim().max(200).optional(),
  employeeRange: z.string().trim().max(40).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  customFields: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
});
export type CompanyInput = z.infer<typeof companyInput>;

export const contactInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  emailStatus: z.enum(VERIFICATION_STATUS).default("unverified"),
  title: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  linkedinUrl: optionalUrl,
  companyId: z.string().uuid().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  source: z.string().trim().max(60).default("manual"),
});
export type ContactInput = z.infer<typeof contactInput>;

export const dealInput = z.object({
  name: z.string().trim().min(1).max(200),
  targetCompanyId: z.string().uuid().optional(),
  buyerCompanyId: z.string().uuid().optional(),
  stage: z.enum(DEAL_STAGES).default("sourced"),
  side: z.enum(["buy_side", "sell_side"]).default("sell_side"),
  estimatedValueUsd: z.number().nonnegative().max(1e13).optional(),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
});
export type DealInput = z.infer<typeof dealInput>;

export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  dueAt: z.string().datetime().optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  assigneeUserId: z.string().uuid().optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const ACTIVITY_TYPES = [
  "note",
  "email",
  "call",
  "meeting",
  "research",
  "stage_change",
  "enrichment",
  "outreach",
  "system",
  "comment",
] as const;

export const activityInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(20000).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ActivityInput = z.infer<typeof activityInput>;

/** Normalise anything URL-ish to a bare registrable-looking host for duplicate detection. */
export function normalizeDomain(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  let s = input.trim().toLowerCase();
  if (!s) return undefined;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|holdings)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
