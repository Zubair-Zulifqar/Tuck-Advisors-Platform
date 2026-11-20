import { z } from "zod";
import { asSystem, NotFoundError } from "@tuck/db";
import { publicRoute } from "@/server/api";
import { env } from "@/server/env";

const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().max(120).optional(), consent: z.literal(true) });

export const POST = publicRoute({ body, rate: [5, 10 * 60_000], name: "subscribe" }, async ({ body, db }) =>
  asSystem(db, async (tx) => {
    const org = (await tx.query<{ id: string }>("select id from public.organizations where slug = $1", [env.PUBLIC_ORG_SLUG])).rows[0];
    if (!org) throw new NotFoundError("Public organisation");
    await tx.query(
      `insert into public.newsletter_subscribers (organization_id, email, name, status, consent_at) values ($1,$2,$3,'subscribed',now())
       on conflict (organization_id, email) do update set status = 'subscribed', consent_at = now()
       where not exists (select 1 from public.suppression_list s where s.organization_id = $1 and s.email = $2 and s.reason in ('bounce','complaint'))`,
      [org.id, body.email, body.name ?? null],
    );
    await tx.query("delete from public.suppression_list where organization_id = $1 and email = $2 and reason = 'unsubscribe'", [org.id, body.email]);
    return { subscribed: true };
  }),
);
