import { z } from "zod";
import { NotFoundError, createCompany, createDeal } from "@tuck/db";
import { route } from "@/server/api";

const body = z.object({ action: z.enum(["review", "dismiss", "convert"]), companyName: z.string().trim().min(1).max(200).optional(), website: z.string().url().optional() });

export const POST = route({ permission: "crm:write", body }, async ({ params, body, tx, auth }) =>
  tx(async (t) => {
    const { rows } = await t.query<{ id: string; title: string; company_id: string | null }>("select id, title, company_id from public.opportunities where organization_id = $1 and id = $2", [auth.organizationId, params.id]);
    const opp = rows[0];
    if (!opp) throw new NotFoundError("Opportunity");
    if (body.action !== "convert") {
      await t.query("update public.opportunities set status = $3 where organization_id = $1 and id = $2", [auth.organizationId, opp.id, body.action === "review" ? "reviewing" : "dismissed"]);
      return { id: opp.id, status: body.action === "review" ? "reviewing" : "dismissed" };
    }
    let companyId = opp.company_id;
    if (!companyId) {
      if (!body.companyName) throw new NotFoundError("Company name is required to convert");
      companyId = (await createCompany(t, auth.organizationId, auth.userId, { name: body.companyName, website: body.website, kind: "target", tags: ["sourced"], customFields: {} })).id;
    }
    const deal = await createDeal(t, auth.organizationId, auth.userId, { name: opp.title.slice(0, 200), targetCompanyId: companyId, stage: "sourced", side: "sell_side" });
    await t.query("update public.opportunities set status = 'converted', company_id = $3 where id = $2 and organization_id = $1", [auth.organizationId, opp.id, companyId]);
    await t.query("update public.deals set opportunity_id = $2 where id = $1", [deal.id, opp.id]);
    return { dealId: deal.id, companyId };
  }),
);
