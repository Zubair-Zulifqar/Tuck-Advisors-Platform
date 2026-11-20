import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ReportBody } from "@/components/app/report-body";
import { ExportReport } from "@/components/app/export-report";
import { ActionButton } from "@/components/app/actions";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

type Source = { id: string; url: string; title: string; provider: string; retrievedAt: string };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await query(async (tx, auth) => ({
    r: (await tx.query<{ id: string; title: string; kind: string; content: unknown; sources: Source[]; providers: { llm?: string; research?: string; mock?: boolean }; needs_review: boolean; reviewed_at: string | null; created_at: string; company_id: string | null; company_name: string | null }>(
      "select r.*, c.name as company_name from research_reports r left join companies c on c.id = r.company_id where r.organization_id = $1 and r.id = $2", [auth.organizationId, id])).rows[0],
    auth,
  }));
  if (!d.r) notFound();
  const r = d.r;
  return (
    <>
      <PageHeader eyebrow={r.kind.replace(/_/g, " ")} title={r.title}
        description={<>Generated {fmtDate(r.created_at, true)} · {r.providers.llm} / {r.providers.research}{r.company_id && <> · <Link className="underline" href={`/app/companies/${r.company_id}`}>{r.company_name}</Link></>}</>}
        actions={<>{r.needs_review && !r.reviewed_at && can(d.auth, "crm:write") && <ActionButton path={`/api/v1/research/reports/${r.id}/review`}>Mark reviewed</ActionButton>}<ExportReport id={r.id} /></>} />
      {r.providers.mock && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">Generated without an AI provider (deterministic extraction only). Configure OPENAI_API_KEY for full analysis.</p>}
      {r.needs_review && !r.reviewed_at && <p className="mb-4"><Badge tone="warn">Contains signals that require human verification before use</Badge></p>}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="p-6"><ReportBody content={r.content} sources={r.sources} /></Card>
        <Card className="h-fit p-5">
          <h3 className="text-sm font-semibold">Sources ({r.sources.length})</h3>
          <ol className="mt-3 space-y-3 text-sm">
            {r.sources.map((s, i) => (
              <li key={s.id} id={`src-${s.id}`}><span className="muted">{i + 1}.</span> <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{s.title || s.url}</a><span className="muted block text-xs">{s.provider} · retrieved {fmtDate(s.retrievedAt, true)}</span></li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
