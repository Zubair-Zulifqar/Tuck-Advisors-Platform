import { z } from "zod";

export const CAMPAIGN_STATUS = ["draft", "in_review", "approved", "scheduled", "sending", "paused", "completed", "cancelled"] as const;
export const MESSAGE_STATUS = ["draft", "approved", "queued", "sent", "delivered", "bounced", "replied", "suppressed", "failed"] as const;

export const campaignInput = z.object({
  name: z.string().trim().min(1).max(160),
  subjectTemplate: z.string().trim().min(1).max(300),
  bodyTemplate: z.string().trim().min(1).max(20000),
  segment: z
    .object({
      tags: z.array(z.string()).default([]),
      companyKinds: z.array(z.string()).default([]),
      requireVerifiedEmail: z.boolean().default(true),
    })
    .default({}),
  dailySendLimit: z.number().int().min(1).max(500).default(50),
  fromName: z.string().trim().min(1).max(100),
  fromEmail: z.string().trim().email(),
  scheduledAt: z.string().datetime().optional(),
});
export type CampaignInput = z.infer<typeof campaignInput>;

const TOKEN = /\{\{\s*([a-zA-Z_.]+)\s*\}\}/g;

/** Mustache-lite rendering. Unknown tokens are reported so a reviewer can fix them rather than send blanks. */
export function renderTemplate(template: string, vars: Record<string, string | undefined | null>) {
  const missing = new Set<string>();
  const text = template.replace(TOKEN, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") {
      missing.add(key);
      return `{{${key}}}`;
    }
    return v;
  });
  return { text, missing: [...missing] };
}

export const COMPLIANCE_FOOTER =
  "\n\n—\nYou are receiving this because of your role at {{company.name}}. Reply \"unsubscribe\" or use {{unsubscribe_url}} to opt out.";
