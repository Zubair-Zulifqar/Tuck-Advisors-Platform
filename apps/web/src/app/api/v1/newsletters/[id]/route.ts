import { z } from "zod";
import { updateNewsletter } from "@tuck/engine";
import { route } from "@/server/api";

const body = z.object({ title: z.string().max(200).optional(), subject: z.string().max(200).optional(), bodyMarkdown: z.string().max(30000).optional() });
export const PATCH = route({ permission: "outreach:draft", body }, async ({ params, body, tx, auth }) => tx((t) => updateNewsletter(t, auth.organizationId, params.id!, body)));
