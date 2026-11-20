import { automationInput } from "@tuck/shared";
import { route } from "@/server/api";

export const GET = route({ permission: "crm:read" }, async ({ tx, auth }) =>
  tx(async (t) => {
    const { rows } = await t.query(
      `select a.id, a.name, a.description, a.trigger_type, a.status, a.definition, a.updated_at,
         count(e.*) filter (where e.created_at > now() - interval '7 days') as runs_7d,
         count(e.*) filter (where e.status = 'failed') as failed,
         count(e.*) filter (where e.status = 'awaiting_approval') as awaiting_approval
       from public.automations a left join public.automation_executions e on e.automation_id = a.id
       where a.organization_id = $1 group by a.id order by a.created_at`,
      [auth.organizationId],
    );
    return rows;
  }),
);

export const POST = route({ permission: "automation:manage", body: automationInput }, async ({ body, tx, auth }) =>
  tx(async (t) => {
    const { rows } = await t.query(
      "insert into public.automations (organization_id, name, description, trigger_type, definition, status, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *",
      [auth.organizationId, body.name, body.description, body.trigger.type, JSON.stringify(body), body.enabled ? "active" : "paused", auth.userId],
    );
    return rows[0];
  }),
);
