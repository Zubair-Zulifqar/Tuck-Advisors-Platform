import { z } from "zod";

/** Page context sent from extension content scripts to the side panel / backend. */
export const linkedinCompanyContext = z.object({
  kind: z.literal("linkedin_company"),
  url: z.string().url(),
  slug: z.string().max(200),
  name: z.string().max(200).optional(),
  tagline: z.string().max(500).optional(),
  industry: z.string().max(200).optional(),
  headquarters: z.string().max(200).optional(),
  website: z.string().max(500).optional(),
  employeeRange: z.string().max(60).optional(),
});
export const linkedinPersonContext = z.object({
  kind: z.literal("linkedin_person"),
  url: z.string().url(),
  slug: z.string().max(200),
  name: z.string().max(200).optional(),
  headline: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  currentCompany: z.string().max(200).optional(),
});
export const gmailThreadContext = z.object({
  kind: z.literal("gmail_thread"),
  url: z.string().url(),
  threadId: z.string().max(200).optional(),
  subject: z.string().max(500).optional(),
  participants: z
    .array(z.object({ name: z.string().max(200).optional(), email: z.string().email() }))
    .max(50),
});
export const crmContext = z.object({ kind: z.literal("tuck_crm"), url: z.string().url(), entity: z.string().optional(), entityId: z.string().optional() });
export const unsupportedContext = z.object({ kind: z.literal("unsupported"), url: z.string() });

export const pageContext = z.discriminatedUnion("kind", [
  linkedinCompanyContext,
  linkedinPersonContext,
  gmailThreadContext,
  crmContext,
  unsupportedContext,
]);
export type PageContext = z.infer<typeof pageContext>;

export const extensionTokenResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable(), organizationId: z.string(), role: z.string() }),
});
export type ExtensionTokenResponse = z.infer<typeof extensionTokenResponse>;
