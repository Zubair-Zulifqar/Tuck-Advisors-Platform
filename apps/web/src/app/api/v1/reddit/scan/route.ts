import { z } from "zod";
import { scanReddit } from "@tuck/engine";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

const body = z.object({ query: z.string().trim().min(3).max(200), subreddits: z.array(z.string().regex(/^[A-Za-z0-9_]{2,21}$/)).max(10).optional(), minScore: z.number().min(0).max(1).optional() });
export const POST = route({ permission: "research:run", body, rate: [6, 60_000] }, async ({ body, auth }) => scanReddit(await getDeps(), auth.organizationId, body));
