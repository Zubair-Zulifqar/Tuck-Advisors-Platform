import { z } from "zod";
import { setTaskStatus } from "@tuck/db";
import { route } from "@/server/api";

export const PATCH = route({ permission: "crm:write", body: z.object({ status: z.enum(["open", "done", "cancelled"]) }) }, async ({ params, body, tx, auth }) => tx((t) => setTaskStatus(t, auth.organizationId, params.id!, body.status)));
