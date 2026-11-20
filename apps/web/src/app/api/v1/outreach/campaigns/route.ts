import { createCampaign } from "@tuck/engine";
import { campaignInput } from "@tuck/shared";
import { route } from "@/server/api";

export const POST = route({ permission: "outreach:draft", body: campaignInput }, async ({ body, tx, auth }) => tx((t) => createCampaign(t, auth.organizationId, auth.userId, body)));
