import { z } from "zod";
import { route } from "@/server/api";

const body = z.object({ name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20000) });
export const POST = route({ permission: "outreach:draft", body }, async ({ body, tx, auth }) =>
  tx(async (t) => (await t.query("insert into public.communication_templates (organization_id, name, subject, body) values ($1,$2,$3,$4) returning *", [auth.organizationId, body.name, body.subject, body.body])).rows[0]),
);
