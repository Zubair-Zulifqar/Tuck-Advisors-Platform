import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact, listActivities, listTasks, NotFoundError } from "@tuck/db";
import { Badge, Card, CardHeader, EmailStatus, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { ActivityForm, TaskCheck, TaskForm } from "@/components/app/forms";
import { ResearchLauncher } from "@/components/app/research";
import { EmailDrafter } from "@/components/app/email-drafter";
import { Timeline } from "@/components/app/timeline";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => {
    try {
      const contact = await getContact(tx, auth.organizationId, id);
      return { contact, activities: await listActivities(tx, auth.organizationId, { contactId: id }), tasks: await listTasks(tx, auth.organizationId, { contactId: id }), auth };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!d) notFound();
  const { contact: c, auth } = d;
  const w = can(auth, "crm:write");
  return (
    <>
      <PageHeader eyebrow="Contact" title={`${c.first_name} ${c.last_name ?? ""}`.trim()}
        description={<>{c.title ?? "Title unknown"}{c.company_id && <> · <Link className="underline" href={`/app/companies/${c.company_id}`}>{c.company_name}</Link></>}</>}
        actions={<>
          {can(auth, "research:run") && <ActionButton path={`/api/v1/contacts/${c.id}/enrich`} variant="brass">Enrich contact</ActionButton>}
          {can(auth, "crm:delete") && <ActionButton path={`/api/v1/contacts/${c.id}`} method="DELETE" variant="danger" confirm="Archive this contact?">Archive</ActionButton>}
        </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Interaction history" />
            <div className="space-y-4 p-5">{w && <ActivityForm contactId={c.id} companyId={c.company_id ?? undefined} />}<Timeline items={d.activities} /></div>
          </Card>
          {can(auth, "outreach:draft") && (
            <Card><CardHeader title="AI-assisted email draft" subtitle="Drafts are for you to edit and send yourself. Nothing is sent automatically." /><div className="p-5"><EmailDrafter contactId={c.id} email={c.email} /></div></Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Professional details" />
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 p-5 text-sm">
              <dt className="muted">Email</dt><dd>{c.email ?? "—"} {c.email && <EmailStatus status={c.email_status} />}{c.email_source && <span className="muted block text-xs">source: {c.email_source}</span>}</dd>
              <dt className="muted">Phone</dt><dd>{c.phone ?? "—"}</dd>
              <dt className="muted">LinkedIn</dt><dd>{c.linkedin_url ? <a className="underline" href={c.linkedin_url} target="_blank" rel="noopener noreferrer">Profile</a> : "—"} <Badge tone={c.linkedin_verification === "manually_verified" ? "good" : "neutral"}>{c.linkedin_verification.replace("_", " ")}</Badge></dd>
              <dt className="muted">Enriched</dt><dd>{c.enriched_at ? fmtDate(c.enriched_at, true) : "Never"}</dd>
              <dt className="muted">Source</dt><dd>{c.source}</dd>
              <dt className="muted">Tags</dt><dd className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</dd>
            </dl>
            {w && (
              <div className="flex flex-wrap gap-2 border-t hairline px-5 py-3">
                {c.email && c.email_status === "unverified" && <ActionButton path={`/api/v1/contacts/${c.id}`} method="PATCH" body={{ emailStatus: "manually_verified" }}>I confirmed this email</ActionButton>}
                {c.linkedin_url && <ActionButton path="/api/v1/linkedin/verify" body={{ entity: "contact", id: c.id, status: "manually_verified" }} variant="ghost">Mark LinkedIn verified</ActionButton>}
              </div>
            )}
          </Card>
          {can(auth, "research:run") && c.company_id && (
            <Card><CardHeader title="Meeting prep" /><div className="p-5"><ResearchLauncher contactId={c.id} kinds={["pre_call_notes", "post_call_notes"]} /></div></Card>
          )}
          <Card>
            <CardHeader title="Follow-ups" />
            <ul className="divide-y divide-[var(--border)] text-sm">{d.tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-2"><TaskCheck id={t.id} done={t.status === "done"} /><span className={t.status === "done" ? "muted line-through" : ""}>{t.title}</span><span className="muted ml-auto text-xs">{fmtDate(t.due_at)}</span></li>)}</ul>
            {w && <div className="border-t hairline p-4"><TaskForm contactId={c.id} companyId={c.company_id ?? undefined} /></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
