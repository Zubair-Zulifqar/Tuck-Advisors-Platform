import { z } from "zod";
import { createActivity, getCompany, getContact, listActivities } from "@tuck/db";
import { activityInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";
import { emit } from "@/server/events";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ url, tx, auth }) => {
  const q = url.searchParams;
  return tx((t) => listActivities(t, auth.organizationId, { companyId: q.get("companyId") ?? undefined, contactId: q.get("contactId") ?? undefined, dealId: q.get("dealId") ?? undefined, type: q.get("type") ?? undefined, limit: Number(q.get("limit")) || 50 }));
});

const body = activityInput.extend({ type: z.enum(["note", "email", "call", "meeting", "comment"]), externalRef: z.string().max(200).optional() });

export const POST = route({ permission: "crm:write", body }, async ({ body, tx, auth }) => {
  const act = await tx(async (t) => {
    if (body.companyId) await getCompany(t, auth.organizationId, body.companyId);
    if (body.contactId) await getContact(t, auth.organizationId, body.contactId);
    return createActivity(t, auth.organizationId, auth.userId, body);
  });
  if (act && body.type === "meeting") await emit(auth, { type: "meeting.completed", payload: { activityId: act.id, companyId: act.company_id, contactId: act.contact_id }, dedupeKey: `meeting:${act.id}` });
  return act; // null => already logged (idempotent by externalRef)
});
