import { z } from "zod";
import { createCompany, listCompanies } from "@tuck/db";
import { companyInput } from "@tuck/shared";
import { preflight, route } from "@/server/api";
import { emit } from "@/server/events";

export const OPTIONS = preflight;

export const GET = route({ permission: "crm:read" }, async ({ url, tx, auth }) => {
  const q = url.searchParams;
  return tx((t) => listCompanies(t, auth.organizationId, { q: q.get("q") ?? undefined, kind: q.get("kind") ?? undefined, tag: q.get("tag") ?? undefined, limit: Number(q.get("limit")) || 50, offset: Number(q.get("offset")) || 0 }));
});

const body = companyInput.extend({ allowDuplicateName: z.boolean().optional(), runResearch: z.boolean().optional() });

export const POST = route({ permission: "crm:write", body }, async ({ body, tx, auth }) => {
  const { allowDuplicateName, runResearch, ...input } = body;
  const company = await tx((t) => createCompany(t, auth.organizationId, auth.userId, input, { allowDuplicateName }));
  await emit(auth, { type: "company.created", payload: { companyId: company.id, kind: company.kind, website: company.website, domain: company.domain, name: company.name, runResearch: !!runResearch }, dedupeKey: `company:${company.id}` });
  return company;
});
