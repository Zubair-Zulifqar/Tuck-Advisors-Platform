import { z } from "zod";
import { createActivity, updateCompany, updateContact } from "@tuck/db";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;

/** Manual LinkedIn verification: a human confirms the LinkedIn page matches the CRM record. No automated scraping. */
const body = z.object({ entity: z.enum(["company", "contact"]), id: z.string().uuid(), status: z.enum(["manually_verified", "mismatch", "unverified"]), linkedinUrl: z.string().url().startsWith("https://www.linkedin.com/").optional() });

export const POST = route({ permission: "crm:write", body }, async ({ body, tx, auth }) =>
  tx(async (t) => {
    const patch = { linkedinVerification: body.status, ...(body.linkedinUrl ? { linkedinUrl: body.linkedinUrl } : {}) };
    const row = body.entity === "company" ? await updateCompany(t, auth.organizationId, body.id, patch) : await updateContact(t, auth.organizationId, body.id, patch);
    await createActivity(t, auth.organizationId, auth.userId, {
      type: "system",
      subject: `LinkedIn ${body.status.replace("_", " ")} by ${auth.name ?? auth.email}`,
      ...(body.entity === "company" ? { companyId: body.id } : { contactId: body.id }),
      metadata: { linkedinVerification: body.status },
    });
    return row;
  }),
);
