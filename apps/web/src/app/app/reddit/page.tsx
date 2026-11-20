import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { ActionButton } from "@/components/app/actions";
import { RedditScan } from "@/components/app/reddit-scan";
import { ConvertOpportunity } from "@/components/app/convert-opportunity";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";
import { integrationStatuses } from "@tuck/integrations";

export default async function RedditPage() {
  const d = await query(async (tx, auth) => ({
    signals: (await tx.query<{ id: string; title: string; url: string; subreddit: string; excerpt: string; signal_types: string[]; score: string; posted_at: string; retrieved_at: string; opportunity_id: string | null }>("select * from reddit_signals where organization_id = $1 order by score desc, retrieved_at desc limit 100", [auth.organizationId])).rows,
    opps: (await tx.query<{ id: string; title: string; source: string; source_url: string | null; status: string; retrieved_at: string | null; created_at: string }>("select * from opportunities where organization_id = $1 order by created_at desc limit 100", [auth.organizationId])).rows,
    auth,
  }));
  const reddit = integrationStatuses(process.env).find((s) => s.provider === "reddit");
  return (
    <>
      <PageHeader eyebrow="Deal sourcing" title="Reddit & opportunity signals" description="Searches public discussions through Reddit's official Data API (OAuth, rate-limited). Every signal keeps its source URL and retrieval time. No scraping, no account automation." />
      {reddit?.mode !== "live" && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">Reddit API credentials are not configured — scans return clearly labelled sample data. Set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.</p>}
      {can(d.auth, "research:run") && <Card className="mb-6 p-5"><RedditScan /></Card>}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={`Signals (${d.signals.length})`} />
          <Table head={["Discussion", "Signals", "Score", ""]}>
            {d.signals.map((s) => (
              <tr key={s.id}>
                <Td><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">{s.title}</a><span className="muted block text-xs">r/{s.subreddit} · posted {fmtDate(s.posted_at)} · retrieved {fmtDate(s.retrieved_at, true)}</span><p className="muted mt-1 line-clamp-2 text-xs">{s.excerpt}</p></Td>
                <Td><div className="flex flex-wrap gap-1">{s.signal_types.map((t) => <Badge key={t} tone="brass">{t.replace(/_/g, " ")}</Badge>)}</div></Td>
                <Td className="tabular-nums">{Number(s.score).toFixed(2)}</Td>
                <Td>{s.opportunity_id ? <Badge tone="good">in CRM</Badge> : can(d.auth, "crm:write") && <ActionButton path={`/api/v1/reddit/signals/${s.id}`}>Save to CRM</ActionButton>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Opportunities" />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {d.opps.map((o) => (
              <li key={o.id} className="space-y-1 px-5 py-3">
                <div className="flex justify-between gap-2"><span className="font-medium">{o.title}</span><Badge tone={o.status === "converted" ? "good" : o.status === "dismissed" ? "neutral" : "info"}>{o.status}</Badge></div>
                <p className="muted text-xs">{o.source}{o.source_url && <> · <a href={o.source_url} target="_blank" rel="noopener noreferrer nofollow" className="underline">source</a></>}</p>
                {can(d.auth, "crm:write") && ["new", "reviewing"].includes(o.status) && <ConvertOpportunity id={o.id} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
