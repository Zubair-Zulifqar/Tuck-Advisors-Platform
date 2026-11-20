import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@tuck/db";
import { ROLES } from "@tuck/shared";
import { route } from "@/server/api";

export const PATCH = route({ permission: "members:manage", body: z.object({ role: z.enum(ROLES) }) }, async ({ params, body, tx, auth }) => {
  if (params.userId === auth.userId) throw new ForbiddenError("You cannot change your own role");
  return tx(async (t) => {
    const { rows } = await t.query("update public.memberships set role = $3 where organization_id = $1 and user_id = $2 returning user_id, role", [auth.organizationId, params.userId, body.role]);
    if (!rows[0]) throw new NotFoundError("Member");
    const owners = await t.query<{ n: string }>("select count(*) as n from public.memberships where organization_id = $1 and role = 'owner'", [auth.organizationId]);
    if (Number(owners.rows[0]?.n) === 0) throw new ForbiddenError("An organisation must keep at least one owner");
    return rows[0];
  });
});
