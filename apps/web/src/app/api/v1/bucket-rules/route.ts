import { z } from "zod";
import { route } from "@/server/api";

const condition = z.object({ field: z.enum(["industry", "businessModel", "geographies", "tags", "employeeCount", "strategicThemes", "products", "customerSegments", "revenueUsd"]), operator: z.enum(["in", "not_in", "contains", "gte", "lte"]), values: z.array(z.union([z.string().max(100), z.number()])).min(1).max(30) });
const body = z.object({ bucket: z.string().trim().min(1).max(80), priority: z.number().int().min(1).max(1000), description: z.string().max(300).optional(), conditions: z.array(condition).min(1).max(10) });

export const GET = route({ permission: "crm:read" }, async ({ tx, auth }) => tx(async (t) => (await t.query("select * from public.buyer_bucket_rules where organization_id = $1 order by priority", [auth.organizationId])).rows));

export const POST = route({ permission: "automation:manage", body }, async ({ body, tx, auth }) =>
  tx(async (t) => (await t.query("insert into public.buyer_bucket_rules (organization_id, bucket, priority, rule, description) values ($1,$2,$3,$4,$5) returning *", [auth.organizationId, body.bucket, body.priority, JSON.stringify(body.conditions), body.description ?? null])).rows[0]),
);

export const DELETE = route({ permission: "automation:manage" }, async ({ tx, auth, url }) =>
  tx(async (t) => {
    await t.query("delete from public.buyer_bucket_rules where organization_id = $1 and id = $2", [auth.organizationId, url.searchParams.get("id")]);
    return { deleted: true };
  }),
);
