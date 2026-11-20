import Link from "next/link";
import { Card, CardHeader, Empty, PageHeader, StageBadge, Stat, Badge } from "@/components/ui";
import { DEAL_STAGES } from "@tuck/shared";
import { fmtDate, relTime } from "@/lib/format";
import { query } from "@/server/session";

export default async function Dashboard() {
  const d = await query(async (tx, auth) => {
    const org = auth.organizationId;
    const one = async <T,>(sql: string) => (await tx.query<T>(sql, [org])).rows;
    const [counts] = await one<Record<string, string>>(`select
      (select count(*) from companies where organization_id = $1 and deleted_at is null) as companies,
      (select count(*) from contacts where organization_id = $1 and deleted_at is null) as contacts,
      (select count(*) from acquisition_targets where organization_id = $1 and status <> 'passed') as targets,
      (select count(*) from deals where organization_id = $1 and stage not in ('won','lost')) as active_deals,
      (select count(*) from research_jobs where organization_id = $1 and status in ('queued','running')) as jobs_active,
      (select count(*) from research_reports where organization_id = $1) as reports,
      (select count(*) from research_reports where organization_id = $1 and needs_review and reviewed_at is null) as reports_review,
      (select count(*) from outreach_messages where organization_id = $1 and sent_at > now() - interval '30 days') as outreach_30d,
      (select count(*) from outreach_messages where organization_id = $1 and replied_at > now() - interval '30 days') as replies_30d,
      (select count(*) from opportunities where organization_id = $1 and status in ('new','reviewing')) as opportunities,
      (select count(*) from automation_executions where organization_id = $1 and status = 'awaiting_approval') as approvals,
      (select count(*) from automation_executions where organization_id = $1 and status = 'failed' and updated_at > now() - interval '7 days') as failed_runs,
      (select count(*) from automation_executions where organization_id = $1 and status = 'succeeded' and updated_at > now() - interval '7 days') as ok_runs`);
    const stages = await one<{ stage: string; n: string }>("select stage, count(*) as n from deals where organization_id = $1 group by stage");
    const followUps = await one<{ id: string; title: string; due_at: string; company_name: string | null }>(
      "select t.id, t.title, t.due_at, c.name as company_name from tasks t left join companies c on c.id = t.company_id where t.organization_id = $1 and t.status = 'open' and t.due_at is not null order by t.due_at limit 8",
    );
    const activity = await one<{ id: string; type: string; subject: string; occurred_at: string; actor: string | null; company_id: string | null; company_name: string | null }>(
      "select a.id, a.type, a.subject, a.occurred_at, u.name as actor, a.company_id, c.name as company_name from activities a left join users u on u.id = a.actor_user_id left join companies c on c.id = a.company_id where a.organization_id = $1 order by a.occurred_at desc limit 12",
    );
    const reports = await one<{ id: string; title: string; kind: string; created_at: string }>("select id, title, kind, created_at from research_reports where organization_id = $1 order by created_at desc limit 6");
    const team = await one<{ name: string; n: string }>(
      "select coalesce(u.name, u.email) as name, count(a.*) as n from memberships m join users u on u.id = m.user_id left join activities a on a.actor_user_id = u.id and a.occurred_at > now() - interval '7 days' where m.organization_id = $1 group by u.id order by count(a.*) desc",
    );
    return { counts: counts!, stages, followUps, activity, reports, team };
  });
  const c = d.counts;
  const stageMap = Object.fromEntries(d.stages.map((s) => [s.stage, Number(s.n)]));
  const maxStage = Math.max(1, ...Object.values(stageMap));
  return (
    <>
      <PageHeader eyebrow="Operations" title="Dashboard" description="Live view of the deal pipeline, research and automation — every number comes from the database." />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Companies" value={c.companies} href="/app/companies" />
        <Stat label="Contacts" value={c.contacts} href="/app/contacts" />
        <Stat label="Acquisition targets" value={c.targets} href="/app/companies?kind=target" />
        <Stat label="Active deals" value={c.active_deals} href="/app/deals" />
        <Stat label="Research jobs" value={c.jobs_active} hint={`${c.reports} reports · ${c.reports_review} to review`} href="/app/research" />
        <Stat label="Open opportunities" value={c.opportunities} href="/app/reddit" />
        <Stat label="Outreach (30d)" value={c.outreach_30d} hint={`${c.replies_30d} replies`} href="/app/outreach" />
        <Stat label="Approvals waiting" value={c.approvals} href="/app/automations" />
        <Stat label="Automation runs (7d)" value={c.ok_runs} hint={`${c.failed_runs} failed`} href="/app/automations" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Pipeline by stage" action={<Link href="/app/deals" className="text-xs text-brass-600">Open board →</Link>} />
          <div className="space-y-2 p-5">
            {DEAL_STAGES.map((s) => (
              <div key={s} className="grid grid-cols-[110px_1fr_32px] items-center gap-3 text-sm">
                <StageBadge stage={s} />
                <div className="h-2 rounded-full bg-black/5 dark:bg-white/10"><div className="h-2 rounded-full bg-navy dark:bg-brass" style={{ width: `${((stageMap[s] ?? 0) / maxStage) * 100}%` }} /></div>
                <span className="text-right tabular-nums">{stageMap[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Upcoming follow-ups" action={<Link href="/app/tasks" className="text-xs text-brass-600">All tasks →</Link>} />
          <ul className="divide-y divide-[var(--border)]">
            {d.followUps.length === 0 && <li className="muted p-5 text-sm">Nothing scheduled.</li>}
            {d.followUps.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <span>{t.title}{t.company_name && <span className="muted block text-xs">{t.company_name}</span>}</span>
                <Badge tone={new Date(t.due_at) < new Date() ? "bad" : "neutral"}>{fmtDate(t.due_at)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Recent CRM activity" />
          <ul className="divide-y divide-[var(--border)]">
            {d.activity.length === 0 && <li className="p-5"><Empty title="No activity yet" /></li>}
            {d.activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <Badge>{a.type.replace("_", " ")}</Badge>
                <span className="flex-1">{a.subject}{a.company_name && <> · <Link className="underline" href={`/app/companies/${a.company_id}`}>{a.company_name}</Link></>}</span>
                <span className="muted whitespace-nowrap text-xs">{a.actor ?? "System"} · {relTime(a.occurred_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Latest AI reports" />
            <ul className="divide-y divide-[var(--border)]">
              {d.reports.length === 0 && <li className="muted p-5 text-sm">No reports yet.</li>}
              {d.reports.map((r) => (
                <li key={r.id} className="px-5 py-2.5 text-sm"><Link href={`/app/research/${r.id}`} className="hover:underline">{r.title}</Link><span className="muted block text-xs">{relTime(r.created_at)}</span></li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Team activity (7 days)" />
            <ul className="space-y-1.5 p-5 text-sm">
              {d.team.map((m) => <li key={m.name} className="flex justify-between"><span>{m.name}</span><span className="tabular-nums muted">{m.n}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
