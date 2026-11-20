import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

type StepRec = { id: string; type: string; status: string; attempt: number; error?: string; output?: unknown; finishedAt?: string; approvedBy?: string };

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => {
    const a = (await tx.query<{ id: string; name: string; description: string; status: string; trigger_type: string; definition: unknown }>("select * from automations where organization_id = $1 and id = $2", [auth.organizationId, id])).rows[0];
    if (!a) return null;
    const execs = (await tx.query<{ id: string; event_type: string; status: string; steps: StepRec[]; error: string | null; created_at: string; resume_at: string | null; attempts: number }>(
      "select * from automation_executions where automation_id = $1 order by created_at desc limit 100", [id])).rows;
    return { a, execs, auth };
  });
  if (!d) notFound();
  const tone = (s: string) => (s === "succeeded" ? "good" : s === "failed" ? "bad" : s === "awaiting_approval" ? "warn" : s === "skipped" || s === "cancelled" ? "neutral" : "info") as "good";
  return (
    <>
      <PageHeader eyebrow={`Trigger: ${d.a.trigger_type}`} title={d.a.name} description={<>{d.a.description} <Badge>{d.a.status}</Badge></>}
        actions={can(d.auth, "automation:manage") ? <>
          {d.a.status !== "active" && <ActionButton path={`/api/v1/automations/${id}`} method="PATCH" body={{ status: "active" }} variant="brass">Enable</ActionButton>}
          {d.a.status === "active" && <ActionButton path={`/api/v1/automations/${id}`} method="PATCH" body={{ status: "paused" }}>Pause</ActionButton>}
          {d.a.status !== "disabled" && <ActionButton path={`/api/v1/automations/${id}`} method="PATCH" body={{ status: "disabled" }} variant="ghost">Disable</ActionButton>}
        </> : undefined} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Execution log" subtitle="Every run, step, attempt and error is recorded." />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {d.execs.length === 0 && <li className="muted p-5">No executions yet.</li>}
            {d.execs.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Badge tone={tone(e.status)}>{e.status.replace("_", " ")}</Badge><span className="muted text-xs">{e.event_type} · {fmtDate(e.created_at, true)}{e.resume_at && e.status === "waiting" && ` · resumes ${fmtDate(e.resume_at, true)}`}</span></span>
                  {can(d.auth, "automation:manage") && (
                    <span className="flex gap-2">
                      {e.status === "failed" && <ActionButton path={`/api/v1/automations/executions/${e.id}`} body={{ action: "retry" }}>Retry</ActionButton>}
                      {e.status === "awaiting_approval" && can(d.auth, "automation:approve") && <ActionButton path={`/api/v1/automations/executions/${e.id}`} body={{ action: "approve" }} variant="brass">Approve</ActionButton>}
                      {["pending", "waiting", "awaiting_approval", "failed"].includes(e.status) && <ActionButton path={`/api/v1/automations/executions/${e.id}`} body={{ action: "cancel" }} variant="ghost">Cancel</ActionButton>}
                    </span>
                  )}
                </div>
                {e.error && <p className="mt-1 text-xs text-rose-600">{e.error}</p>}
                {e.steps.length > 0 && (
                  <ol className="mt-2 space-y-1 text-xs">{e.steps.map((s, i) => <li key={i} className="flex flex-wrap gap-2"><span className="muted">{i + 1}.</span><code>{s.type}</code><Badge tone={tone(s.status)}>{s.status}</Badge>{s.attempt > 1 && <span className="muted">attempt {s.attempt}</span>}{s.approvedBy && <span className="muted">approved</span>}{s.error && <span className="text-rose-600">{s.error}</span>}</li>)}</ol>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card><CardHeader title="Definition" /><pre className="overflow-auto p-5 text-xs">{JSON.stringify(d.a.definition, null, 2)}</pre></Card>
      </div>
    </>
  );
}
