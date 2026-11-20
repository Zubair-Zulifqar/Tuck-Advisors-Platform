import { z } from "zod";
import { enqueueResearch } from "@tuck/engine";
import { RESEARCH_KINDS } from "@tuck/shared";
import { ok, preflight, route } from "@/server/api";

export const OPTIONS = preflight;

const body = z.object({
  kind: z.enum(RESEARCH_KINDS).refine((k) => k !== "ma_analyzer" && k !== "reddit_signals", "Use the dedicated endpoint for this research type"),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  input: z.object({ transcript: z.string().max(60_000).optional(), notes: z.string().max(60_000).optional() }).partial().default({}),
});

export const GET = route({ permission: "crm:read" }, async ({ tx, auth, url }) =>
  tx(async (t) => {
    const companyId = url.searchParams.get("companyId");
    const { rows } = await t.query(
      `select j.id, j.kind, j.status, j.attempts, j.last_error, j.report_id, j.created_at, j.finished_at, c.name as company_name
       from public.research_jobs j left join public.companies c on c.id = j.company_id
       where j.organization_id = $1 and ($2::uuid is null or j.company_id = $2) order by j.created_at desc limit 100`,
      [auth.organizationId, companyId],
    );
    return rows;
  }),
);

export const POST = route({ permission: "research:run", body, rate: [60, 60_000] }, async ({ req, body, tx, auth }) => {
  const transcript = body.input.transcript ?? body.input.notes;
  const job = await tx((t) => enqueueResearch(t, auth.organizationId, auth.userId, { kind: body.kind, companyId: body.companyId, contactId: body.contactId, input: transcript ? { transcript } : {} }));
  return ok(req, { id: job.id, status: job.status, kind: job.kind }, 202);
});
