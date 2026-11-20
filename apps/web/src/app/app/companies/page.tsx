import Link from "next/link";
import { listCompanies } from "@tuck/db";
import { COMPANY_KINDS } from "@tuck/shared";
import { Badge, Card, Empty, PageHeader, Table, Td } from "@/components/ui";
import { CompanyForm, CsvImport, Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { relTime } from "@/lib/format";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; tag?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { data, auth } = await query(async (tx, auth) => ({ data: await listCompanies(tx, auth.organizationId, { q: sp.q, kind: sp.kind, tag: sp.tag, limit: 50, offset: (page - 1) * 50 }), auth }));
  const writable = can(auth, "crm:write");
  return (
    <>
      <PageHeader eyebrow="CRM" title="Companies" description={`${data.total} companies across prospects, targets, buyers and clients.`}
        actions={<>
          <a href="/api/v1/companies/export" className="surface rounded-md px-3.5 py-2 text-sm hover:border-brass/60">Export CSV</a>
          {writable && <Disclosure label="Add company"><CompanyForm /><hr className="hairline my-4" /><p className="label">Or import CSV</p><CsvImport /></Disclosure>}
        </>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, domain, industry" className="field max-w-xs" />
        <select name="kind" defaultValue={sp.kind ?? ""} className="field max-w-[160px]"><option value="">All types</option>{COMPANY_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="field max-w-[140px]" />
        <button className="surface rounded-md px-3 text-sm">Filter</button>
      </form>
      <Card>
        {data.items.length === 0 ? <div className="p-6"><Empty title="No companies match">Try a different search or add one.</Empty></div> : (
          <Table head={["Company", "Type", "Industry", "HQ", "Tags", "LinkedIn", "Updated"]}>
            {data.items.map((c) => (
              <tr key={c.id} className="hover:bg-black/[.02] dark:hover:bg-white/[.03]">
                <Td><Link href={`/app/companies/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{c.domain && <span className="muted block text-xs">{c.domain}</span>}</Td>
                <Td><Badge tone={c.kind === "buyer" ? "info" : c.kind === "target" ? "brass" : "neutral"}>{c.kind}</Badge></Td>
                <Td>{c.industry ?? <span className="muted">—</span>}</Td>
                <Td>{c.headquarters ?? <span className="muted">—</span>}</Td>
                <Td><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Link key={t} href={`?tag=${encodeURIComponent(t)}`}><Badge>{t}</Badge></Link>)}</div></Td>
                <Td>{c.linkedin_verification === "manually_verified" ? <Badge tone="good">Verified</Badge> : <span className="muted text-xs">{c.linkedin_verification}</span>}</Td>
                <Td className="muted whitespace-nowrap text-xs">{relTime(c.updated_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="mt-4 flex gap-3 text-sm">
        {page > 1 && <Link href={{ query: { ...sp, page: page - 1 } }}>← Previous</Link>}
        {page * 50 < data.total && <Link href={{ query: { ...sp, page: page + 1 } }}>Next →</Link>}
      </div>
    </>
  );
}
