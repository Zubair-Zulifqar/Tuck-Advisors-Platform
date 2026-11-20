import { normalizeCompanyName, normalizeDomain, type CompanyInput } from "@tuck/shared";
import type { Queryable } from "../driver";
import { ConflictError, NotFoundError, buildSet, clampLimit, likePattern } from "./util";

export interface CompanyRow {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  industry: string | null;
  kind: string;
  headquarters: string | null;
  employee_range: string | null;
  description: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  linkedin_verification: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyFilter {
  q?: string;
  kind?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function listCompanies(tx: Queryable, orgId: string, f: CompanyFilter = {}) {
  const where = ["organization_id = $1", "deleted_at is null"];
  const params: unknown[] = [orgId];
  if (f.q) {
    params.push(likePattern(f.q));
    const p = `$${params.length}`;
    where.push(`(name ilike ${p} or domain ilike ${p} or industry ilike ${p})`);
  }
  if (f.kind) {
    params.push(f.kind);
    where.push(`kind = $${params.length}`);
  }
  if (f.tag) {
    params.push(f.tag);
    where.push(`$${params.length} = any(tags)`);
  }
  params.push(clampLimit(f.limit), Math.max(0, Number(f.offset) || 0));
  const { rows } = await tx.query<CompanyRow & { total: string }>(
    `select *, count(*) over() as total from public.companies where ${where.join(" and ")}
     order by updated_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows.map(({ total: _t, ...r }) => r as CompanyRow), total: Number(rows[0]?.total ?? 0) };
}

export async function getCompany(tx: Queryable, orgId: string, id: string): Promise<CompanyRow> {
  const { rows } = await tx.query<CompanyRow>(
    "select * from public.companies where organization_id = $1 and id = $2 and deleted_at is null",
    [orgId, id],
  );
  if (!rows[0]) throw new NotFoundError("Company");
  return rows[0];
}

export interface DuplicateMatch {
  id: string;
  name: string;
  domain: string | null;
  reason: "domain" | "name" | "linkedin";
}

export async function findCompanyDuplicates(
  tx: Queryable,
  orgId: string,
  input: { name?: string; domain?: string | null; website?: string | null; linkedinUrl?: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const domain = normalizeDomain(input.domain ?? input.website ?? undefined) ?? null;
  const norm = input.name ? normalizeCompanyName(input.name) : null;
  const { rows } = await tx.query<{ id: string; name: string; domain: string | null; linkedin_url: string | null }>(
    `select id, name, domain, linkedin_url from public.companies
     where organization_id = $1 and deleted_at is null and ($5::uuid is null or id <> $5::uuid)
       and ((domain is not null and domain = $2) or (normalized_name <> '' and normalized_name = $3)
            or (linkedin_url is not null and linkedin_url = $4))
     limit 10`,
    [orgId, domain, norm, input.linkedinUrl ?? null, excludeId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    reason:
      domain && r.domain === domain ? "domain" : input.linkedinUrl && r.linkedin_url === input.linkedinUrl ? "linkedin" : "name",
  }));
}

export async function createCompany(
  tx: Queryable,
  orgId: string,
  userId: string | null,
  input: CompanyInput,
  opts: { allowDuplicateName?: boolean } = {},
): Promise<CompanyRow> {
  const domain = normalizeDomain(input.domain ?? input.website) ?? null;
  const dups = await findCompanyDuplicates(tx, orgId, { ...input, domain });
  const blocking = dups.filter((d) => d.reason !== "name" || !opts.allowDuplicateName);
  if (blocking.length) throw new ConflictError("A matching company already exists", { duplicates: blocking });
  const { rows } = await tx.query<CompanyRow>(
    `insert into public.companies (organization_id, name, normalized_name, domain, website, linkedin_url, industry, kind,
       headquarters, employee_range, description, tags, custom_fields, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [
      orgId,
      input.name,
      normalizeCompanyName(input.name),
      domain,
      input.website ?? null,
      input.linkedinUrl ?? null,
      input.industry ?? null,
      input.kind ?? "prospect",
      input.headquarters ?? null,
      input.employeeRange ?? null,
      input.description ?? null,
      input.tags ?? [],
      JSON.stringify(input.customFields ?? {}),
      userId,
    ],
  );
  return rows[0]!;
}

const COLUMNS: Record<string, string> = {
  name: "name",
  website: "website",
  linkedinUrl: "linkedin_url",
  industry: "industry",
  kind: "kind",
  headquarters: "headquarters",
  employeeRange: "employee_range",
  description: "description",
  tags: "tags",
  customFields: "custom_fields",
  linkedinVerification: "linkedin_verification",
};

export type CompanyPatch = Partial<CompanyInput> & { linkedinVerification?: "unverified" | "manually_verified" | "mismatch" };

export async function updateCompany(tx: Queryable, orgId: string, id: string, patch: CompanyPatch) {
  const params: unknown[] = [orgId, id];
  const sets = buildSet(patch as Record<string, unknown>, COLUMNS, params, ["customFields"]);
  if (patch.name !== undefined) {
    params.push(normalizeCompanyName(patch.name));
    sets.push(`normalized_name = $${params.length}`);
  }
  if (patch.domain !== undefined || patch.website !== undefined) {
    const domain = normalizeDomain(patch.domain ?? patch.website) ?? null;
    if (domain) {
      const dups = (await findCompanyDuplicates(tx, orgId, { domain }, id)).filter((d) => d.reason === "domain");
      if (dups.length) throw new ConflictError("Another company already uses this domain", { duplicates: dups });
    }
    params.push(domain);
    sets.push(`domain = $${params.length}`);
  }
  if (!sets.length) return getCompany(tx, orgId, id);
  const { rows } = await tx.query<CompanyRow>(
    `update public.companies set ${sets.join(", ")} where organization_id = $1 and id = $2 and deleted_at is null returning *`,
    params,
  );
  if (!rows[0]) throw new NotFoundError("Company");
  return rows[0];
}

export async function softDeleteCompany(tx: Queryable, orgId: string, id: string) {
  const { rows } = await tx.query(
    "update public.companies set deleted_at = now() where organization_id = $1 and id = $2 and deleted_at is null returning id",
    [orgId, id],
  );
  if (!rows[0]) throw new NotFoundError("Company");
}
