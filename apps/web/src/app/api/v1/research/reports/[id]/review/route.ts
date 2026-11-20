import { NotFoundError } from "@tuck/db";
import { route } from "@/server/api";

export const POST = route({ permission: "crm:write" }, async ({ params, tx, auth }) =>
  tx(async (t) => {
    const { rows } = await t.query("update public.research_reports set reviewed_by = $3, reviewed_at = now() where organization_id = $1 and id = $2 returning id", [auth.organizationId, params.id, auth.userId]);
    if (!rows[0]) throw new NotFoundError("Report");
    return rows[0];
  }),
);
