import Link from "next/link";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { TaskCheck, TaskForm } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const sp = await searchParams;
  const d = await query(async (tx, auth) => ({
    tasks: (await tx.query<{ id: string; title: string; status: string; due_at: string | null; source: string; company_id: string | null; company_name: string | null; contact_id: string | null; contact_name: string | null; assignee: string | null }>(
      `select t.*, c.name as company_name, ct.first_name || ' ' || coalesce(ct.last_name,'') as contact_name, u.name as assignee
       from tasks t left join companies c on c.id = t.company_id left join contacts ct on ct.id = t.contact_id left join users u on u.id = t.assignee_user_id
       where t.organization_id = $1 and t.status = $2 and ($3::uuid is null or t.assignee_user_id = $3) order by t.due_at asc nulls last limit 300`,
      [auth.organizationId, sp.status ?? "open", sp.mine ? auth.userId : null])).rows,
    auth,
  }));
  return (
    <>
      <PageHeader eyebrow="Workflow" title="Tasks & follow-ups" actions={<div className="flex gap-2 text-sm"><Link href="?status=open" className="underline">Open</Link><Link href="?status=open&mine=1" className="underline">Mine</Link><Link href="?status=done" className="underline">Done</Link></div>} />
      {can(d.auth, "crm:write") && <Card className="mb-4 p-4"><TaskForm /></Card>}
      <Card>
        <Table head={["", "Task", "Related", "Assignee", "Due", "Source"]}>
          {d.tasks.map((t) => (
            <tr key={t.id}>
              <Td><TaskCheck id={t.id} done={t.status === "done"} /></Td>
              <Td className={t.status === "done" ? "muted line-through" : ""}>{t.title}</Td>
              <Td className="text-xs">{t.company_id && <Link className="underline" href={`/app/companies/${t.company_id}`}>{t.company_name}</Link>} {t.contact_id && <Link className="underline" href={`/app/contacts/${t.contact_id}`}>{t.contact_name}</Link>}</Td>
              <Td className="text-xs">{t.assignee ?? "—"}</Td>
              <Td>{t.due_at ? <Badge tone={t.status === "open" && new Date(t.due_at) < new Date() ? "bad" : "neutral"}>{fmtDate(t.due_at)}</Badge> : "—"}</Td>
              <Td className="muted text-xs">{t.source}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
