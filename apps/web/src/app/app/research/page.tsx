import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { query } from "@/server/session";
import { fmtDate, relTime } from "@/lib/format";

export default async function ResearchPage() {
  const d = await query(async (tx, auth) => ({
    jobs: (await tx.query<{ id: string; kind: string; status: string; last_error: string | null; created_at: string; company_name: string | null; report_id: string | null; attempts: number }>(
      "select j.*, c.name as company_name from research_jobs j left join companies c on c.id = j.company_id where j.organization_id = $1 order by j.created_at desc limit 50", [auth.organizationId])).rows,
    reports: (await tx.query<{ id: string; title: string; kind: string; created_at: string; needs_review: boolean; reviewed_at: string | null; providers: { mock?: boolean } }>(
      "select id, title, kind, created_at, needs_review, reviewed_at, providers from research_reports where organization_id = $1 order by created_at desc limit 100", [auth.organizationId])).rows,
  }));
  const tone = (s: string) => (s === "succeeded" ? "good" : s === "failed" ? "bad" : s === "running" ? "info" : "neutral") as "good";
  return (
    <>
      <PageHeader eyebrow="AI research engine" title="Research workspace" description="Run research from any company or contact page. Jobs run in the background with retries; every report keeps its sources and retrieval timestamps." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Reports" />
          <Table head={["Report", "Type", "Created"]}>
            {d.reports.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/app/research/${r.id}`} className="font-medium hover:underline">{r.title}</Link> {r.needs_review && !r.reviewed_at && <Badge tone="warn">needs review</Badge>} {r.providers?.mock && <Badge>mock AI</Badge>}</Td>
                <Td className="text-xs">{r.kind.replace(/_/g, " ")}</Td>
                <Td className="muted whitespace-nowrap text-xs">{fmtDate(r.created_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Job history" subtitle="Background queue with retry/backoff for transient provider failures." />
          <Table head={["Job", "Status", "When"]}>
            {d.jobs.map((j) => (
              <tr key={j.id}>
                <Td>{j.kind.replace(/_/g, " ")}{j.company_name && <span className="muted block text-xs">{j.company_name}</span>}{j.last_error && <span className="block text-xs text-rose-600">{j.last_error}</span>}</Td>
                <Td><Badge tone={tone(j.status)}>{j.status}</Badge>{j.attempts > 1 && <span className="muted block text-xs">{j.attempts} attempts</span>}</Td>
                <Td className="muted whitespace-nowrap text-xs">{relTime(j.created_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
