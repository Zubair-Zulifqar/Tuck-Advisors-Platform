import { createContact, listContacts } from "@tuck/db";
import { contactInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";
import { emit } from "@/server/events";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ url, tx, auth }) => {
  const q = url.searchParams;
  return tx((t) => listContacts(t, auth.organizationId, { q: q.get("q") ?? undefined, companyId: q.get("companyId") ?? undefined, emailStatus: q.get("emailStatus") ?? undefined, tag: q.get("tag") ?? undefined, limit: Number(q.get("limit")) || 50, offset: Number(q.get("offset")) || 0 }));
});

export const POST = route({ permission: "crm:write", body: contactInput }, async ({ body, tx, auth }) => {
  const contact = await tx((t) => createContact(t, auth.organizationId, auth.userId, body));
  await emit(auth, { type: "contact.created", payload: { contactId: contact.id, companyId: contact.company_id, email: contact.email, source: contact.source }, dedupeKey: `contact:${contact.id}` });
  return contact;
});
