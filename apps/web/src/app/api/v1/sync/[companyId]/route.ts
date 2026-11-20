import { getCompany } from "@tuck/db";
import { syncCompanyToExternalCrm } from "@tuck/engine";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

/** Push a company (and its latest fit score) to Pipeline CRM through the integration layer. */
export const POST = route({ permission: "integrations:manage", rate: [30, 60_000] }, async ({ params, tx, auth }) => {
  await tx((t) => getCompany(t, auth.organizationId, params.companyId!));
  return syncCompanyToExternalCrm(await getDeps(), auth.organizationId, params.companyId!);
});
