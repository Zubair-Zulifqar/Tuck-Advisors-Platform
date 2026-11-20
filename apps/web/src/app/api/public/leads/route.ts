import { z } from "zod";
import { asSystem, NotFoundError, createActivity } from "@tuck/db";
import { publicRoute } from "@/server/api";
import { env } from "@/server/env";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().trim().max(200).optional(),
  interest: z.enum(["sell_side", "buy_side", "analyzer", "general"]),
  message: z.string().trim().max(4000).optional(),
  analysisId: z.string().uuid().optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Please agree to be contacted" }) }),
  website: z.string().max(0).optional(), // honeypot: must stay empty
});

export const POST = publicRoute({ body, rate: [5, 10 * 60_000], name: "lead" }, async ({ body, db }) =>
  asSystem(db, async (tx) => {
    const org = (await tx.query<{ id: string }>("select id from public.organizations where slug = $1", [env.PUBLIC_ORG_SLUG])).rows[0];
    if (!org) throw new NotFoundError("Public organisation");
    const { rows } = await tx.query<{ id: string }>(
      "insert into public.leads (organization_id, name, email, company, interest, message, analysis_id, consent_at) values ($1,$2,$3,$4,$5,$6,$7,now()) returning id",
      [org.id, body.name, body.email, body.company ?? null, body.interest, body.message ?? null, body.analysisId ?? null],
    );
    await createActivity(tx, org.id, null, { type: "system", subject: `New website lead: ${body.name}${body.company ? ` (${body.company})` : ""} — ${body.interest.replace("_", " ")}`, metadata: { leadId: rows[0]!.id } });
    return { received: true };
  }),
);
