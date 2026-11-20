import { convertSignalToOpportunity } from "@tuck/engine";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

export const POST = route({ permission: "crm:write" }, async ({ params, auth }) => convertSignalToOpportunity(await getDeps(), auth.organizationId, auth.userId, params.id!));
