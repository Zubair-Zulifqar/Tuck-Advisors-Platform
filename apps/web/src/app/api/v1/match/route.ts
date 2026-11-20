import { findCompanyDuplicates, findContactMatches, getCompany, listDeals, type CompanyRow } from "@tuck/db";
import { normalizeDomain } from "@tuck/shared";
import { preflight, route } from "@/server/api";

export const OPTIONS = preflight;

/** CRM lookup used by the extension: match by domain, LinkedIn URL, company name and/or email addresses. */
export const GET = route({ permission: "crm:read", rate: [120, 60_000] }, async ({ url, tx, auth }) => {
  const q = url.searchParams;
  const emails = (q.get("emails") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)).slice(0, 50);
  const linkedinUrl = q.get("linkedinUrl")?.slice(0, 500) || undefined;
  const name = q.get("name")?.slice(0, 200) || undefined;
  const domainParam = normalizeDomain(q.get("domain")) ?? undefined;
  return tx(async (t) => {
    const org = auth.organizationId;
    const contacts = await findContactMatches(t, org, { emails, linkedinUrl });
    const emailDomains = emails.map((e) => e.split("@")[1]!).filter((d) => !/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton(mail)?)\./.test(d));
    const companyIds = new Set<string>();
    for (const d of [domainParam, ...emailDomains].filter(Boolean) as string[]) (await findCompanyDuplicates(t, org, { domain: d })).forEach((m) => companyIds.add(m.id));
    if (linkedinUrl || name) (await findCompanyDuplicates(t, org, { linkedinUrl, name })).forEach((m) => companyIds.add(m.id));
    contacts.forEach((c) => c.company_id && companyIds.add(c.company_id));
    const companies: CompanyRow[] = [];
    for (const id of [...companyIds].slice(0, 20)) companies.push(await getCompany(t, org, id));
    const deals = (await Promise.all(companies.map((c) => listDeals(t, org, { companyId: c.id })))).flat();
    const uniqueDeals = [...new Map(deals.map((d) => [d.id, d])).values()].map((d) => ({ id: d.id, name: d.name, stage: d.stage, target_company_id: d.target_company_id, buyer_company_id: d.buyer_company_id }));
    return { companies, contacts, deals: uniqueDeals };
  });
});
