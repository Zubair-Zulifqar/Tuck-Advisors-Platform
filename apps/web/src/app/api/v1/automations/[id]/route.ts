import { z } from "zod";
import { NotFoundError } from "@tuck/db";
import { automationInput } from "@tuck/shared";
import { route } from "@/server/api";

export const GET = route({ permission: "crm:read" }, async ({ params, tx, auth, url }) =>
  tx(async (t) => {
    const a = (await t.query("select * from public.automations where organization_id = $1 and id = $2", [auth.organizationId, params.id])).rows[0];
    if (!a) throw new NotFoundError("Automation");
    const status = url.searchParams.get("status");
    const executions = (
      await t.query(
        "select id, event_type, status, current_step, attempts, steps, error, resume_at, created_at, updated_at from public.automation_executions where automation_id = $1 and ($2::text is null or status = $2) order by created_at desc limit 100",
        [params.id, status],
      )
    ).rows;
    return { automation: a, executions };
  }),
);

const patch = z.object({ status: z.enum(["active", "paused", "disabled"]).optional(), definition: automationInput.optional() });

export const PATCH = route({ permission: "automation:manage", body: patch }, async ({ params, body, tx, auth }) =>
  tx(async (t) => {
    const sets: string[] = [];
    const vals: unknown[] = [auth.organizationId, params.id];
    if (body.status) {
      vals.push(body.status);
      sets.push(`status = $${vals.length}`);
    }
    if (body.definition) {
      vals.push(JSON.stringify(body.definition), body.definition.name, body.definition.description, body.definition.trigger.type);
      sets.push(`definition = $${vals.length - 3}`, `name = $${vals.length - 2}`, `description = $${vals.length - 1}`, `trigger_type = $${vals.length}`);
    }
    if (!sets.length) throw new NotFoundError("Nothing to update");
    const { rows } = await t.query(`update public.automations set ${sets.join(", ")} where organization_id = $1 and id = $2 returning *`, vals);
    if (!rows[0]) throw new NotFoundError("Automation");
    return rows[0];
  }),
);
