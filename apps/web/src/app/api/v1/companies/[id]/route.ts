import { getCompany, listActivities, listContacts, listDeals, softDeleteCompany, updateCompany } from "@tuck/db";
import { companyInput } from "@tuck/shared";
import { z } from "zod";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ params, tx, auth }) =>
  tx(async (t) => {
    const org = auth.organizationId;
    const company = await getCompany(t, org, params.id!);
    const [contacts, deals, activities] = await Promise.all([listContacts(t, org, { companyId: company.id }), listDeals(t, org, { companyId: company.id }), listActivities(t, org, { companyId: company.id, limit: 50 })]);
    return { company, contacts: contacts.items, deals, activities };
  }),
);

const patch = companyInput.partial().extend({ linkedinVerification: z.enum(["unverified", "manually_verified", "mismatch"]).optional() });

export const PATCH = route({ permission: "crm:write", body: patch }, async ({ params, body, tx, auth }) => tx((t) => updateCompany(t, auth.organizationId, params.id!, body)));

export const DELETE = route({ permission: "crm:delete" }, async ({ params, tx, auth }) => {
  await tx((t) => softDeleteCompany(t, auth.organizationId, params.id!));
  return { deleted: true };
});
