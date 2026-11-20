import type { ContactInput, VerificationStatus } from "@tuck/shared";
import type { Queryable } from "../driver";
import { ConflictError, NotFoundError, buildSet, clampLimit, likePattern } from "./util";

export interface ContactRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  company_name?: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  email_status: VerificationStatus;
  email_source: string | null;
  title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  linkedin_verification: string;
  tags: string[];
  source: string;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `select c.*, co.name as company_name from public.contacts c
  left join public.companies co on co.id = c.company_id and co.deleted_at is null`;

export async function listContacts(
  tx: Queryable,
  orgId: string,
  f: { q?: string; companyId?: string; emailStatus?: string; tag?: string; limit?: number; offset?: number } = {},
) {
  const where = ["c.organization_id = $1", "c.deleted_at is null"];
  const params: unknown[] = [orgId];
  if (f.q) {
    params.push(likePattern(f.q));
    const p = `$${params.length}`;
    where.push(`(c.first_name ilike ${p} or c.last_name ilike ${p} or c.email ilike ${p} or c.title ilike ${p})`);
  }
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`c.company_id = $${params.length}`);
  }
  if (f.emailStatus) {
    params.push(f.emailStatus);
    where.push(`c.email_status = $${params.length}`);
  }
  if (f.tag) {
    params.push(f.tag);
    where.push(`$${params.length} = any(c.tags)`);
  }
  params.push(clampLimit(f.limit), Math.max(0, Number(f.offset) || 0));
  const { rows } = await tx.query<ContactRow>(
    `${SELECT} where ${where.join(" and ")} order by c.updated_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const { rows: cnt } = await tx.query<{ n: string }>(
    `select count(*) as n from public.contacts c where ${where.join(" and ")}`,
    params.slice(0, -2),
  );
  return { items: rows, total: Number(cnt[0]?.n ?? 0) };
}

export async function getContact(tx: Queryable, orgId: string, id: string): Promise<ContactRow> {
  const { rows } = await tx.query<ContactRow>(`${SELECT} where c.organization_id = $1 and c.id = $2 and c.deleted_at is null`, [orgId, id]);
  if (!rows[0]) throw new NotFoundError("Contact");
  return rows[0];
}

export async function findContactMatches(tx: Queryable, orgId: string, q: { emails?: string[]; linkedinUrl?: string }) {
  const emails = (q.emails ?? []).map((e) => e.toLowerCase());
  if (!emails.length && !q.linkedinUrl) return [];
  const { rows } = await tx.query<ContactRow>(
    `${SELECT} where c.organization_id = $1 and c.deleted_at is null and (c.email = any($2::text[]) or ($3::text is not null and c.linkedin_url = $3))`,
    [orgId, emails, q.linkedinUrl ?? null],
  );
  return rows;
}

export async function createContact(tx: Queryable, orgId: string, userId: string | null, input: ContactInput): Promise<ContactRow> {
  const dup = await findContactMatches(tx, orgId, { emails: input.email ? [input.email] : [], linkedinUrl: input.linkedinUrl });
  if (dup.length)
    throw new ConflictError("A matching contact already exists", {
      duplicates: dup.map((d) => ({ id: d.id, name: `${d.first_name} ${d.last_name ?? ""}`.trim(), email: d.email })),
    });
  if (input.companyId) {
    const { rows } = await tx.query("select 1 from public.companies where organization_id = $1 and id = $2 and deleted_at is null", [orgId, input.companyId]);
    if (!rows[0]) throw new NotFoundError("Company");
  }
  // A caller can never mark an address provider-verified directly; only enrichment results can.
  const emailStatus = input.emailStatus === "provider_verified" ? "unverified" : input.emailStatus;
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.contacts (organization_id, company_id, first_name, last_name, email, email_status, email_source, title, phone,
       linkedin_url, tags, source, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [
      orgId,
      input.companyId ?? null,
      input.firstName,
      input.lastName ?? null,
      input.email ?? null,
      input.email ? emailStatus : "unverified",
      input.email ? input.source : null,
      input.title ?? null,
      input.phone ?? null,
      input.linkedinUrl ?? null,
      input.tags ?? [],
      input.source ?? "manual",
      userId,
    ],
  );
  return getContact(tx, orgId, rows[0]!.id);
}

const COLUMNS: Record<string, string> = {
  firstName: "first_name",
  lastName: "last_name",
  title: "title",
  phone: "phone",
  linkedinUrl: "linkedin_url",
  companyId: "company_id",
  tags: "tags",
  emailStatus: "email_status",
  linkedinVerification: "linkedin_verification",
};

export async function updateContact(
  tx: Queryable,
  orgId: string,
  id: string,
  patch: Partial<ContactInput> & { linkedinVerification?: string },
) {
  if (patch.emailStatus === "provider_verified") delete patch.emailStatus;
  const params: unknown[] = [orgId, id];
  const sets = buildSet(patch as Record<string, unknown>, COLUMNS, params);
  if (patch.email !== undefined) {
    if (patch.email) {
      const dup = (await findContactMatches(tx, orgId, { emails: [patch.email] })).filter((d) => d.id !== id);
      if (dup.length) throw new ConflictError("Another contact already uses this email");
    }
    params.push(patch.email ?? null);
    sets.push(`email = $${params.length}`);
    if (patch.emailStatus === undefined) sets.push(`email_status = 'unverified'`);
  }
  if (!sets.length) return getContact(tx, orgId, id);
  const { rows } = await tx.query<{ id: string }>(
    `update public.contacts set ${sets.join(", ")} where organization_id = $1 and id = $2 and deleted_at is null returning id`,
    params,
  );
  if (!rows[0]) throw new NotFoundError("Contact");
  return getContact(tx, orgId, id);
}

/** Records the result of an enrichment provider. Only "verified" provider responses mark the email verified. */
export async function applyEnrichment(
  tx: Queryable,
  orgId: string,
  id: string,
  r: { email?: string | null; emailVerified: boolean; title?: string | null; linkedinUrl?: string | null; provider: string },
) {
  const current = await getContact(tx, orgId, id);
  const email = current.email ?? r.email ?? null;
  const status = r.email && email === r.email.toLowerCase() ? (r.emailVerified ? "provider_verified" : "unverified") : current.email_status;
  await tx.query(
    `update public.contacts set email = $3, email_status = $4, email_source = coalesce($5, email_source),
       title = coalesce(title, $6), linkedin_url = coalesce(linkedin_url, $7), enriched_at = now()
     where organization_id = $1 and id = $2`,
    [orgId, id, email?.toLowerCase() ?? null, status, r.email ? r.provider : null, r.title ?? null, r.linkedinUrl ?? null],
  );
  return getContact(tx, orgId, id);
}

export async function softDeleteContact(tx: Queryable, orgId: string, id: string) {
  const { rows } = await tx.query(
    "update public.contacts set deleted_at = now() where organization_id = $1 and id = $2 and deleted_at is null returning id",
    [orgId, id],
  );
  if (!rows[0]) throw new NotFoundError("Contact");
}
