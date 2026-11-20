import { z } from "zod";
import { draftNewsletter } from "@tuck/engine";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

const body = z.object({ title: z.string().trim().min(3).max(200), topic: z.string().trim().min(3).max(500) });
export const POST = route({ permission: "outreach:draft", body, rate: [10, 60_000] }, async ({ body, auth }) => draftNewsletter(await getDeps(), auth.organizationId, auth.userId, body));
