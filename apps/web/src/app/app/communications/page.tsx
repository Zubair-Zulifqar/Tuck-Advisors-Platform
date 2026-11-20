import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ApiForm, str } from "@/components/app/actions";
import { Disclosure } from "@/components/app/forms";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams;
  const d = await query(async (tx, auth) => ({
    items: (await tx.query<{ id: string; type: string; subject: string; body: string | null; occurred_at: string; metadata: { draft?: boolean }; contact_id: string | null; contact_name: string | null; company_id: string | null; company_name: string | null; actor: string | null }>(
      `select a.*, ct.first_name || ' ' || coalesce(ct.last_name,'') as contact_name, c.name as company_name, u.name as actor
       from activities a left join contacts ct on ct.id = a.contact_id left join companies c on c.id = a.company_id left join users u on u.id = a.actor_user_id
       where a.organization_id = $1 and a.type = any($2::text[]) order by a.occurred_at desc limit 150`,
      [auth.organizationId, sp.type ? [sp.type] : ["email", "call", "meeting", "outreach", "comment", "note"]])).rows,
    templates: (await tx.query<{ id: string; name: string; subject: string; body: string }>("select * from communication_templates where organization_id = $1 order by name", [auth.organizationId])).rows,
    auth,
  }));
  return (
    <>
      <PageHeader eyebrow="Client communications" title="Communications" description="Every email, call, meeting note and internal comment across the firm. Draft emails from any contact page — Tuck never sends client email on its own." />
      <div className="mb-4 flex flex-wrap gap-3 text-sm">{["", "email", "call", "meeting", "outreach", "comment", "note"].map((t) => <Link key={t} href={t ? `?type=${t}` : "?"} className={sp.type === t || (!sp.type && !t) ? "font-semibold underline" : "muted"}>{t || "all"}</Link>)}</div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {d.items.map((a) => (
              <li key={a.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={a.type === "comment" ? "brass" : "neutral"}>{a.type}</Badge><span className="font-medium">{a.subject}</span>{a.metadata?.draft && <Badge tone="warn">draft — not sent</Badge>}</div>
                <p className="muted mt-0.5 text-xs">{a.actor ?? "System"} · {fmtDate(a.occurred_at, true)}{a.contact_id && <> · <Link className="underline" href={`/app/contacts/${a.contact_id}`}>{a.contact_name}</Link></>}{a.company_id && <> · <Link className="underline" href={`/app/companies/${a.company_id}`}>{a.company_name}</Link></>}</p>
                {a.body && <p className="muted mt-1 line-clamp-3 whitespace-pre-line">{a.body}</p>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Templates" subtitle="Tokens: {{first_name}}, {{company.name}}, {{company.industry}}, {{personalized_opener}}, {{sender_name}}" />
          <ul className="divide-y divide-[var(--border)] text-sm">{d.templates.map((t) => <li key={t.id} className="px-5 py-3"><p className="font-medium">{t.name}</p><p className="muted text-xs">{t.subject}</p><pre className="muted mt-1 whitespace-pre-wrap font-sans text-xs">{t.body}</pre></li>)}</ul>
          {can(d.auth, "outreach:draft") && (
            <div className="border-t hairline p-5">
              <Disclosure label="New template">
                <ApiForm path="/api/v1/templates" toBody={(f) => ({ name: str(f, "name"), subject: str(f, "subject"), body: str(f, "body") })}>
                  <input name="name" required placeholder="Name" className="field" />
                  <input name="subject" required placeholder="Subject" className="field" />
                  <textarea name="body" required rows={6} placeholder="Body" className="field" />
                </ApiForm>
              </Disclosure>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
