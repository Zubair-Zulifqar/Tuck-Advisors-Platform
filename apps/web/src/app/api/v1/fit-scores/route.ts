import { z } from "zod";
import { calculateFitScore } from "@tuck/engine";
import { getCompany } from "@tuck/db";
import { preflight, route } from "@/server/api";
import { getDeps } from "@/server/db";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ tx, auth, url }) =>
  tx(async (t) => {
    const { rows } = await t.query(
      `select f.id, f.score, f.grade, f.confidence, f.result, f.created_at, f.synced_to_crm_at, m.version as model_version, m.name as model_name,
              b.name as buyer_name, tg.name as target_name, f.buyer_company_id, f.target_company_id
       from public.fit_scores f join public.matrix_models m on m.id = f.matrix_model_id
       join public.companies b on b.id = f.buyer_company_id join public.companies tg on tg.id = f.target_company_id
       where f.organization_id = $1 and ($2::uuid is null or f.target_company_id = $2 or f.buyer_company_id = $2)
       order by f.created_at desc limit 100`,
      [auth.organizationId, url.searchParams.get("companyId")],
    );
    return rows;
  }),
);

const body = z.object({ buyerCompanyId: z.string().uuid(), targetCompanyId: z.string().uuid() });

export const POST = route({ permission: "research:run", body, rate: [60, 60_000] }, async ({ body, tx, auth }) => {
  await tx(async (t) => {
    await getCompany(t, auth.organizationId, body.buyerCompanyId);
    await getCompany(t, auth.organizationId, body.targetCompanyId);
  });
  const r = await calculateFitScore(await getDeps(), auth.organizationId, body.buyerCompanyId, body.targetCompanyId, auth.userId);
  return { id: r.id, score: r.result };
});
