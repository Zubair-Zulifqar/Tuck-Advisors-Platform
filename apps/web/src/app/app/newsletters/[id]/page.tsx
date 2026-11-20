import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton, ApiForm, str } from "@/components/app/actions";
import { can, query } from "@/server/session";

export default async function NewsletterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => ({
    n: (await tx.query<{ id: string; title: string; subject: string; body_markdown: string; status: string; research_notes: { url: string; title: string }[]; created_by: string; approved_by: string | null }>("select * from newsletters where organization_id = $1 and id = $2", [auth.organizationId, id])).rows[0],
    auth,
  }));
  if (!d.n) notFound();
  const { n, auth } = d;
  const base = `/api/v1/newsletters/${n.id}`;
  const editable = ["draft", "in_review"].includes(n.status) && can(auth, "outreach:draft");
  return (
    <>
      <PageHeader eyebrow="Newsletter" title={n.title} description={<Badge>{n.status.replace("_", " ")}</Badge>}
        actions={<>
          {n.status === "draft" && <ActionButton path={`${base}/submit`}>Submit for review</ActionButton>}
          {n.status === "in_review" && can(auth, "newsletter:approve") && n.created_by !== auth.userId && <ActionButton path={`${base}/approve`} variant="brass" confirm="Approve this issue for sending?">Approve</ActionButton>}
          {n.status === "in_review" && n.created_by === auth.userId && <span className="muted self-center text-xs">Awaiting approval from another team member</span>}
        </>} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          {editable ? (
            <ApiForm path={base} method="PATCH" resetOnSuccess={false} submitLabel="Save draft" toBody={(f) => ({ title: str(f, "title"), subject: str(f, "subject"), bodyMarkdown: String(f.get("body") ?? "") })}>
              <input name="title" defaultValue={n.title} className="field" aria-label="Title" />
              <input name="subject" defaultValue={n.subject} className="field" aria-label="Subject" />
              <textarea name="body" defaultValue={n.body_markdown} rows={22} className="field font-mono text-xs" aria-label="Body (Markdown)" />
              {n.status === "in_review" && <p className="muted text-xs">Saving changes returns the issue to draft.</p>}
            </ApiForm>
          ) : <pre className="whitespace-pre-wrap font-sans text-sm">{n.body_markdown}</pre>}
        </Card>
        <div className="space-y-6">
          {n.status === "approved" && can(auth, "newsletter:approve") && (
            <Card><CardHeader title="Schedule delivery" subtitle="Sent only to subscribers who gave consent and are not suppressed." /><div className="p-5">
              <ApiForm path={`${base}/schedule`} submitLabel="Schedule" toBody={(f) => ({ scheduledAt: new Date(String(f.get("at"))).toISOString() })}><input type="datetime-local" name="at" required className="field" /></ApiForm>
            </div></Card>
          )}
          <Card><CardHeader title="Research sources" /><ol className="space-y-2 p-5 text-sm">{n.research_notes.length ? n.research_notes.map((s, i) => <li key={i}>{i + 1}. <a className="underline" href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title}</a></li>) : <li className="muted">No sources retrieved.</li>}</ol></Card>
        </div>
      </div>
    </>
  );
}
