import { z } from "zod";
import { enrichContact } from "@tuck/engine";
import { getContact } from "@tuck/db";
import { preflight, route } from "@/server/api";
import { getDeps } from "@/server/db";

export const OPTIONS = preflight;
const body = z.object({ provider: z.enum(["apollo", "rocketreach"]).optional() }).default({});

export const POST = route({ permission: "research:run", body, rate: [30, 60_000] }, async ({ params, body, tx, auth }) => {
  await tx((t) => getContact(t, auth.organizationId, params.id!)); // org access check under RLS
  const r = await enrichContact(await getDeps(), auth.organizationId, params.id!, auth.userId, body.provider);
  return { ...r.contact, enrichment: { provider: r.result.provider, found: r.result.found, emailVerified: r.result.emailVerified, mock: r.result.mock } };
});
