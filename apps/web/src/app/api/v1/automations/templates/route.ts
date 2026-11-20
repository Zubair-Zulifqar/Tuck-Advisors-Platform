import { z } from "zod";
import { AUTOMATION_TEMPLATES } from "@tuck/engine";
import { NotFoundError } from "@tuck/db";
import { route } from "@/server/api";

export const GET = route({ permission: "crm:read" }, async () => AUTOMATION_TEMPLATES.map(({ key, category, name, description, trigger, actions }) => ({ key, category, name, description, trigger: trigger.type, steps: actions.map((a) => a.type) })));

export const POST = route({ permission: "automation:manage", body: z.object({ key: z.string().max(60) }) }, async ({ body, tx, auth }) => {
  const tpl = AUTOMATION_TEMPLATES.find((t) => t.key === body.key);
  if (!tpl) throw new NotFoundError("Template");
  const { key: _k, category: _c, ...def } = tpl;
  return tx(async (t) => {
    const { rows } = await t.query(
      "insert into public.automations (organization_id, name, description, trigger_type, definition, status, created_by) values ($1,$2,$3,$4,$5,'paused',$6) returning *",
      [auth.organizationId, def.name, def.description, def.trigger.type, JSON.stringify(def), auth.userId],
    );
    return rows[0]; // installed paused so a human reviews before enabling
  });
});
