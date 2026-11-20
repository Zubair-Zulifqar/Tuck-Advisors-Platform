import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompany, listActivities, listContacts, listDeals, listTasks, NotFoundError } from "@tuck/db";
import { Badge, Card, CardHeader, EmailStatus, Empty, PageHeader, StageBadge } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { ActivityForm, ContactForm, Disclosure, TaskCheck, TaskForm } from "@/components/app/forms";
import { FitScoreForm, ResearchLauncher } from "@/components/app/research";
import { EditCompany } from "@/components/app/edit-company";
import { Timeline } from "@/components/app/timeline";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => {
    const org = auth.organizationId;
    try {
      const company = await getCompany(tx, org, id);
      const [contacts, deals, activities, tasks, reports, scores, buyer, all] = await Promise.all([
        listContacts(tx, org, { companyId: id, limit: 100 }),
        listDeals(tx, org, { companyId: id }),
        listActivities(tx, org, { companyId: id, limit: 50 }),
        listTasks(tx, org, { companyId: id }),
        tx.query<{ id: string; title: string; kind: string; created_at: string; needs_review: boolean }>("select id, title, kind, created_at, needs_review from research_reports where organization_id = $1 and company_id = $2 order by created_at desc limit 20", [org, id]),
        tx.query<{ id: string; score: string | null; grade: string; created_at: string; buyer: string; target: string; version: number }>("select f.id, f.score, f.grade, f.created_at, b.name as buyer, t.name as target, m.version from fit_scores f join companies b on b.id = f.buyer_company_id join companies t on t.id = f.target_company_id join matrix_models m on m.id = f.matrix_model_id where f.organization_id = $1 and (f.buyer_company_id = $2 or f.target_company_id = $2) order by f.created_at desc limit 10", [org, id]),
        tx.query<{ bucket: string | null; bucket_explanation: string[] }>("select bucket, bucket_explanation from buyers where organization_id = $1 and company_id = $2", [org, id]),
        tx.query<{ id: string; name: string; kind: string }>("select id, name, kind from companies where organization_id = $1 and deleted_at is null order by name limit 500", [org]),
      ]);
      return { company, contacts: contacts.items, deals, activities, tasks, reports: reports.rows, scores: scores.rows, bucket: buyer.rows[0], all: all.rows, auth };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!d) notFound();
  const { company: c, auth } = d;
  const w = can(auth, "crm:write");
  return (
    <>
      <PageHeader eyebrow={c.kind} title={c.name}
        description={<>{c.industry ?? "Industry unknown"}{c.headquarters && ` · ${c.headquarters}`}{c.website && <> · <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">{c.domain ?? c.website}</a></>}</>}
        actions={<>
          {can(auth, "integrations:manage") && <ActionButton path={`/api/v1/sync/${c.id}`}>Sync to Pipeline CRM</ActionButton>}
          {can(auth, "crm:delete") && <ActionButton path={`/api/v1/companies/${c.id}`} method="DELETE" variant="danger" confirm="Archive this company? It will be permanently purged after 30 days.">Archive</ActionButton>}
        </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="AI research" subtitle="Reports cite their sources; unknowns are never filled in." />
            <div className="space-y-4 p-5">
              {can(auth, "research:run") ? <ResearchLauncher companyId={c.id} /> : <p className="muted text-sm">Viewers cannot run research.</p>}
              {d.reports.length > 0 && (
                <ul className="divide-y divide-[var(--border)] text-sm">
                  {d.reports.map((r) => <li key={r.id} className="flex justify-between py-2"><Link href={`/app/research/${r.id}`} className="hover:underline">{r.title}</Link><span className="flex items-center gap-2">{r.needs_review && <Badge tone="warn">needs review</Badge>}<span className="muted text-xs">{fmtDate(r.created_at)}</span></span></li>)}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Activity timeline" />
            <div className="space-y-4 p-5">
              {w && <ActivityForm companyId={c.id} />}
              <Timeline items={d.activities} />
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" action={w ? <EditCompany company={c} /> : undefined} />
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 p-5 text-sm">
              <dt className="muted">Employees</dt><dd>{c.employee_range ?? "—"}</dd>
              <dt className="muted">Tags</dt><dd className="flex flex-wrap gap-1">{c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : "—"}</dd>
              <dt className="muted">LinkedIn</dt><dd>{c.linkedin_url ? <a href={c.linkedin_url} className="underline" target="_blank" rel="noopener noreferrer">Profile</a> : "—"} <Badge tone={c.linkedin_verification === "manually_verified" ? "good" : c.linkedin_verification === "mismatch" ? "bad" : "neutral"}>{c.linkedin_verification.replace("_", " ")}</Badge></dd>
              {Object.entries(c.custom_fields).map(([k, v]) => <><dt key={`k${k}`} className="muted">{k.replace(/_/g, " ")}</dt><dd key={`v${k}`}>{String(v)}</dd></>)}
              {d.bucket && <><dt className="muted">Buyer bucket</dt><dd>{d.bucket.bucket ?? "Unclassified"}</dd></>}
            </dl>
            {c.description && <p className="muted border-t hairline px-5 py-3 text-sm">{c.description}</p>}
            {w && c.linkedin_url && (
              <div className="flex gap-2 border-t hairline px-5 py-3">
                <ActionButton path="/api/v1/linkedin/verify" body={{ entity: "company", id: c.id, status: "manually_verified" }}>Mark LinkedIn verified</ActionButton>
                <ActionButton path="/api/v1/linkedin/verify" body={{ entity: "company", id: c.id, status: "mismatch" }} variant="ghost">Mismatch</ActionButton>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="AI Fit Scores" />
            <div className="space-y-4 p-5">
              {can(auth, "research:run") && <FitScoreForm companies={d.all} defaultTarget={c.kind === "buyer" ? undefined : c.id} />}
              <ul className="divide-y divide-[var(--border)] text-sm">
                {d.scores.map((s) => <li key={s.id} className="flex justify-between py-2"><span>{s.buyer} → {s.target}<span className="muted block text-xs">matrix v{s.version} · {fmtDate(s.created_at)}</span></span><span className="text-right font-semibold tabular-nums">{s.score ?? "—"}<span className="muted block text-xs font-normal">{s.grade.replace("_", " ")}</span></span></li>)}
              </ul>
            </div>
          </Card>
          <Card>
            <CardHeader title={`Contacts (${d.contacts.length})`} />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {d.contacts.map((p) => <li key={p.id} className="px-5 py-2"><Link className="font-medium hover:underline" href={`/app/contacts/${p.id}`}>{p.first_name} {p.last_name}</Link><span className="muted block text-xs">{p.title ?? "—"}</span>{p.email && <span className="flex items-center gap-2 text-xs">{p.email} <EmailStatus status={p.email_status} /></span>}</li>)}
            </ul>
            {w && <div className="border-t hairline p-4"><Disclosure label="Add contact"><ContactForm companies={[{ id: c.id, name: c.name }]} defaultCompanyId={c.id} /></Disclosure></div>}
          </Card>
          <Card>
            <CardHeader title="Deals" />
            {d.deals.length === 0 ? <div className="p-5"><Empty title="No deals yet" /></div> : (
              <ul className="divide-y divide-[var(--border)] text-sm">{d.deals.map((x) => <li key={x.id} className="flex items-center justify-between px-5 py-2"><Link href="/app/deals" className="hover:underline">{x.name}</Link><StageBadge stage={x.stage} /></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Tasks" />
            <ul className="divide-y divide-[var(--border)] text-sm">
              {d.tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-2"><TaskCheck id={t.id} done={t.status === "done"} /><span className={t.status === "done" ? "muted line-through" : ""}>{t.title}</span><span className="muted ml-auto text-xs">{fmtDate(t.due_at)}</span></li>)}
            </ul>
            {w && <div className="border-t hairline p-4"><TaskForm companyId={c.id} /></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
