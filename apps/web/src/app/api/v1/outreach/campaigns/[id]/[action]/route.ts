import { z } from "zod";
import { approveCampaign, campaignAnalytics, generateCampaignMessages, getCampaign, setCampaignStatus, submitCampaignForReview } from "@tuck/engine";
import { ForbiddenError, NotFoundError } from "@tuck/db";
import { roleHas } from "@tuck/shared";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

const body = z.object({ contactIds: z.array(z.string().uuid()).max(2000).optional(), personalize: z.boolean().optional(), messageId: z.string().uuid().optional(), subject: z.string().max(300).optional(), text: z.string().max(20000).optional() }).default({});

export const POST = route({ permission: "outreach:draft", body, rate: [30, 60_000] }, async ({ params, body, tx, auth }) => {
  const id = params.id!;
  const org = auth.organizationId;
  const needsApprover = ["approve", "start", "resume"].includes(params.action!);
  if (needsApprover && !roleHas(auth.role, "outreach:approve")) throw new ForbiddenError("Only admins can approve or start outreach");
  await tx((t) => getCampaign(t, org, id));
  switch (params.action) {
    case "generate":
      return generateCampaignMessages(await getDeps(), org, auth.userId, id, { contactIds: body.contactIds, personalize: body.personalize });
    case "edit-message":
      return tx(async (t) => {
        const { rows } = await t.query(
          "update public.outreach_messages set subject = coalesce($4, subject), body = coalesce($5, body), error = null where organization_id = $1 and campaign_id = $2 and id = $3 and status = 'draft' returning id",
          [org, id, body.messageId, body.subject ?? null, body.text ?? null],
        );
        if (!rows[0]) throw new NotFoundError("Draft message");
        return rows[0];
      });
    case "submit":
      await tx((t) => submitCampaignForReview(t, org, id));
      return { status: "in_review" };
    case "approve":
      if (!roleHas(auth.role, "outreach:approve")) throw new ForbiddenError("Only admins can approve outreach");
      return tx((t) => approveCampaign(t, org, auth.userId, id));
    case "start":
    case "pause":
    case "resume":
    case "cancel":
      if (params.action !== "pause" && params.action !== "cancel" && !roleHas(auth.role, "outreach:approve")) throw new ForbiddenError("Only admins can start sending");
      await tx((t) => setCampaignStatus(t, org, id, params.action as "start"));
      return { ok: true };
    case "analytics":
      return tx((t) => campaignAnalytics(t, org, id));
    default:
      throw new NotFoundError("Action");
  }
});
