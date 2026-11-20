import { NotFoundError } from "@tuck/db";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ params, tx, auth }) =>
  tx(async (t) => {
    const { rows } = await t.query<{ id: string; status: string; kind: string; last_error: string | null; report_id: string | null }>(
      "select id, status, kind, last_error, report_id from public.research_jobs where organization_id = $1 and id = $2",
      [auth.organizationId, params.id],
    );
    const job = rows[0];
    if (!job) throw new NotFoundError("Research job");
    const report = job.report_id
      ? (await t.query("select id, title, kind, content, sources, providers, needs_review, created_at from public.research_reports where id = $1", [job.report_id])).rows[0] ?? null
      : null;
    return { ...job, report };
  }),
);
