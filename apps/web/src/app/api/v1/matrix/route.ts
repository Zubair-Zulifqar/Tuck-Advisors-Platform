import { publishMatrixVersion } from "@tuck/engine";
import { matrixModelInput } from "@tuck/shared";
import { route } from "@/server/api";

export const GET = route({ permission: "crm:read" }, async ({ tx, auth }) =>
  tx(async (t) => (await t.query("select id, key, version, name, definition, is_active, created_at from public.matrix_models where organization_id = $1 order by key, version desc", [auth.organizationId])).rows),
);

/** Publishing creates a new immutable version; prior scores keep referencing the version they used. */
export const POST = route({ permission: "automation:manage", body: matrixModelInput }, async ({ body, tx, auth }) => tx((t) => publishMatrixVersion(t, auth.organizationId, auth.userId, body)));
