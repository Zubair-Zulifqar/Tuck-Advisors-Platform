import { asSystem, NotFoundError } from "@tuck/db";
import { runAnalyzer } from "@tuck/engine";
import { analyzerRequest } from "@tuck/shared";
import { publicRoute } from "@/server/api";
import { getDeps } from "@/server/db";
import { env } from "@/server/env";

export const maxDuration = 60;

/** Public M&A Analyzer. Results are only stored when the visitor explicitly consents. */
export const POST = publicRoute({ body: analyzerRequest, rate: [5, 10 * 60_000], name: "analyze" }, async ({ body, db }) => {
  const deps = await getDeps();
  const report = await runAnalyzer(deps, { targetUrl: body.targetUrl, buyerUrl: body.buyerUrl });
  if (!body.saveConsent) return { report, saved: false };
  const id = await asSystem(db, async (tx) => {
    const org = (await tx.query<{ id: string }>("select id from public.organizations where slug = $1", [env.PUBLIC_ORG_SLUG])).rows[0];
    if (!org) throw new NotFoundError("Public organisation");
    const { rows } = await tx.query<{ id: string }>(
      "insert into public.ai_analyses (organization_id, target_url, buyer_url, report, fit_score, requester_email, consent_at) values ($1,$2,$3,$4,$5,$6,now()) returning id",
      [org.id, body.targetUrl, body.buyerUrl, JSON.stringify(report), report.fit.score, body.email ?? null],
    );
    return rows[0]!.id;
  });
  return { report: { ...report, id }, saved: true };
});
