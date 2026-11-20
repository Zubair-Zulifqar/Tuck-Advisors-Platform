import Link from "next/link";
import { listContacts } from "@tuck/db";
import { Card, EmailStatus, Empty, PageHeader, Table, Td } from "@/components/ui";
import { ContactForm, Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; emailStatus?: string }> }) {
  const sp = await searchParams;
  const d = await query(async (tx, auth) => ({
    list: await listContacts(tx, auth.organizationId, { q: sp.q, emailStatus: sp.emailStatus, limit: 100 }),
    companies: (await tx.query<{ id: string; name: string }>("select id, name from companies where organization_id = $1 and deleted_at is null order by name limit 500", [auth.organizationId])).rows,
    auth,
  }));
  return (
    <>
      <PageHeader eyebrow="CRM" title="Contacts" description={`${d.list.total} contacts. Email addresses are only marked verified by a provider or a person — never guessed.`}
        actions={can(d.auth, "crm:write") ? <Disclosure label="Add contact"><ContactForm companies={d.companies} /></Disclosure> : undefined} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, email, title" className="field max-w-xs" />
        <select name="emailStatus" defaultValue={sp.emailStatus ?? ""} className="field max-w-[200px]"><option value="">Any email status</option><option value="provider_verified">Provider verified</option><option value="manually_verified">Manually verified</option><option value="unverified">Unverified</option><option value="invalid">Invalid</option></select>
        <button className="surface rounded-md px-3 text-sm">Filter</button>
      </form>
      <Card>
        {d.list.items.length === 0 ? <div className="p-6"><Empty title="No contacts found" /></div> : (
          <Table head={["Name", "Title", "Company", "Email", "Source"]}>
            {d.list.items.map((c) => (
              <tr key={c.id}>
                <Td><Link href={`/app/contacts/${c.id}`} className="font-medium hover:underline">{c.first_name} {c.last_name}</Link></Td>
                <Td>{c.title ?? <span className="muted">—</span>}</Td>
                <Td>{c.company_id ? <Link className="hover:underline" href={`/app/companies/${c.company_id}`}>{c.company_name}</Link> : <span className="muted">—</span>}</Td>
                <Td>{c.email ? <span className="flex flex-wrap items-center gap-2">{c.email}<EmailStatus status={c.email_status} /></span> : <span className="muted">—</span>}</Td>
                <Td className="muted text-xs">{c.source}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
