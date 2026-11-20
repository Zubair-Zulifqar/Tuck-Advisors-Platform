import { z } from "zod";
import { asSystem } from "@tuck/db";
import { suppressEmail } from "@tuck/engine";
import { publicRoute } from "@/server/api";

const body = z.union([z.object({ token: z.string().regex(/^[a-f0-9]{32,80}$/) }), z.object({ email: z.string().email(), organizationId: z.string().uuid() })]);

/** One-click unsubscribe (newsletter token or outreach link). Always responds the same to avoid address probing. */
export const POST = publicRoute({ body, rate: [20, 10 * 60_000], name: "unsubscribe" }, async ({ body, db }) => {
  await asSystem(db, async (tx) => {
    if ("token" in body) {
      const { rows } = await tx.query<{ organization_id: string; email: string }>("select organization_id, email from public.newsletter_subscribers where unsubscribe_token = $1", [body.token]);
      if (rows[0]) await suppressEmail(tx, rows[0].organization_id, rows[0].email);
    } else {
      const org = await tx.query("select 1 from public.organizations where id = $1", [body.organizationId]);
      if (org.rows[0]) await suppressEmail(tx, body.organizationId, body.email);
    }
  });
  return { unsubscribed: true };
});
