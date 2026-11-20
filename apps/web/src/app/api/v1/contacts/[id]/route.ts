import { z } from "zod";
import { getContact, listActivities, listTasks, softDeleteContact, updateContact } from "@tuck/db";
import { contactInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ params, tx, auth }) =>
  tx(async (t) => {
    const contact = await getContact(t, auth.organizationId, params.id!);
    const [activities, tasks] = await Promise.all([listActivities(t, auth.organizationId, { contactId: contact.id }), listTasks(t, auth.organizationId, { contactId: contact.id })]);
    return { contact, activities, tasks };
  }),
);

const patch = contactInput.partial().extend({ linkedinVerification: z.enum(["unverified", "manually_verified", "mismatch"]).optional() });
export const PATCH = route({ permission: "crm:write", body: patch }, async ({ params, body, tx, auth }) => tx((t) => updateContact(t, auth.organizationId, params.id!, body)));

export const DELETE = route({ permission: "crm:delete" }, async ({ params, tx, auth }) => {
  await tx((t) => softDeleteContact(t, auth.organizationId, params.id!));
  return { deleted: true };
});
