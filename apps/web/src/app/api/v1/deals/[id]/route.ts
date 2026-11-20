import { z } from "zod";
import { changeDealStage, getDeal, listActivities, updateDeal } from "@tuck/db";
import { DEAL_STAGES, dealInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";
import { emit } from "@/server/events";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ params, tx, auth }) =>
  tx(async (t) => ({ deal: await getDeal(t, auth.organizationId, params.id!), activities: await listActivities(t, auth.organizationId, { dealId: params.id! }) })),
);

const patch = dealInput.partial().omit({ stage: true }).extend({ stage: z.enum(DEAL_STAGES).optional() });

export const PATCH = route({ permission: "crm:write", body: patch }, async ({ params, body, tx, auth }) => {
  const { stage, ...rest } = body;
  const result = await tx(async (t) => {
    if (Object.keys(rest).length) await updateDeal(t, auth.organizationId, params.id!, rest);
    return stage ? changeDealStage(t, auth.organizationId, auth.userId, params.id!, stage) : { deal: await getDeal(t, auth.organizationId, params.id!), changed: false, from: null };
  });
  if (result.changed)
    await emit(auth, {
      type: "deal.stage_changed",
      payload: { dealId: result.deal.id, dealName: result.deal.name, from: result.from, to: result.deal.stage, companyId: result.deal.target_company_id, targetCompanyId: result.deal.target_company_id, buyerCompanyId: result.deal.buyer_company_id },
      dedupeKey: `deal:${result.deal.id}:${result.deal.stage}:${Date.now()}`,
    });
  return result.deal;
});
