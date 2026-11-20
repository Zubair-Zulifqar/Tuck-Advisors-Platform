import { createDeal, listDeals } from "@tuck/db";
import { dealInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;
export const GET = route({ permission: "crm:read" }, async ({ url, tx, auth }) => tx((t) => listDeals(t, auth.organizationId, { stage: url.searchParams.get("stage") ?? undefined })));
export const POST = route({ permission: "crm:write", body: dealInput }, async ({ body, tx, auth }) => tx((t) => createDeal(t, auth.organizationId, auth.userId, body)));
