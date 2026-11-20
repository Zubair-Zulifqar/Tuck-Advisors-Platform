import { DEFAULT_MATRIX, type MatrixModelInput } from "@tuck/shared";
import { Badge, Card, CardHeader, PageHeader, Table, Td } from "@/components/ui";
import { FitScoreForm } from "@/components/app/research";
import { MatrixEditor, BucketRuleForm } from "@/components/app/matrix-editor";
import { ActionButton } from "@/components/app/actions";
import { can, query } from "@/server/session";
import { fmtDate } from "@/lib/format";

export default async function MatrixPage() {
  const d = await query(async (tx, auth) => {
    const org = auth.organizationId;
    return {
      models: (await tx.query<{ id: string; key: string; version: number; name: string; definition: MatrixModelInput; is_active: boolean; created_at: string }>("select * from matrix_models where organization_id = $1 order by key, version desc", [org])).rows,
      rules: (await tx.query<{ id: string; bucket: string; priority: number; rule: { field: string; operator: string; values: unknown[] }[]; description: string | null }>("select * from buyer_bucket_rules where organization_id = $1 order by priority", [org])).rows,
      scores: (await tx.query<{ id: string; score: string | null; grade: string; confidence: string; created_at: string; buyer: string; target: string; version: number; synced_to_crm_at: string | null }>(
        "select f.id, f.score, f.grade, f.confidence, f.created_at, f.synced_to_crm_at, b.name as buyer, t.name as target, m.version from fit_scores f join companies b on b.id = f.buyer_company_id join companies t on t.id = f.target_company_id join matrix_models m on m.id = f.matrix_model_id where f.organization_id = $1 order by f.created_at desc limit 25", [org])).rows,
      companies: (await tx.query<{ id: string; name: string; kind: string }>("select id, name, kind from companies where organization_id = $1 and deleted_at is null order by name limit 500", [org])).rows,
      auth,
    };
  });
  const active = d.models.find((m) => m.is_active) ?? null;
  const manage = can(d.auth, "automation:manage");
  return (
    <>
      <PageHeader eyebrow="Scoring" title="M&A Matrix & AI Fit Score" description="Weighted, explainable compatibility scoring computed by the Python scoring service. Models are versioned — publishing creates a new version and old scores keep their original model." />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title={active ? `${active.name} · v${active.version} (active)` : "No active model"} subtitle="Edit weights, required criteria and thresholds, then publish a new version." />
          <div className="p-5">{manage ? <MatrixEditor model={active?.definition ?? DEFAULT_MATRIX} /> : <pre className="text-xs">{JSON.stringify(active?.definition, null, 2)}</pre>}</div>
        </Card>
        <div className="space-y-6">
          {can(d.auth, "research:run") && <Card><CardHeader title="Score a buyer / target pair" /><div className="p-5"><FitScoreForm companies={d.companies} /></div></Card>}
          <Card>
            <CardHeader title="Version history" />
            <ul className="divide-y divide-[var(--border)] text-sm">{d.models.map((m) => <li key={m.id} className="flex justify-between px-5 py-2"><span>{m.name} v{m.version}</span><span>{m.is_active ? <Badge tone="good">active</Badge> : <span className="muted text-xs">{fmtDate(m.created_at)}</span>}</span></li>)}</ul>
          </Card>
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent fit scores" subtitle="Synced to the external CRM through the Pipeline CRM adapter." />
          <Table head={["Pair", "Score", "Confidence", "Model", "CRM"]}>
            {d.scores.map((s) => (
              <tr key={s.id}><Td>{s.buyer} → {s.target}<span className="muted block text-xs">{fmtDate(s.created_at, true)}</span></Td><Td className="font-semibold tabular-nums">{s.score ?? "—"}<span className="muted block text-xs font-normal">{s.grade.replace("_", " ")}</span></Td><Td className="tabular-nums">{(Number(s.confidence) * 100).toFixed(0)}%</Td><Td>v{s.version}</Td><Td className="text-xs">{s.synced_to_crm_at ? fmtDate(s.synced_to_crm_at) : "—"}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card>
          <CardHeader title="Buyer bucket rules" subtitle="Configurable classification — lowest priority number wins; all conditions must match." />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {d.rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                <span><strong>{r.bucket}</strong> <span className="muted text-xs">priority {r.priority}</span><span className="muted block text-xs">{r.rule.map((c) => `${c.field} ${c.operator} ${c.values.join("/")}`).join(" AND ")}</span></span>
                {manage && <ActionButton path={`/api/v1/bucket-rules?id=${r.id}`} method="DELETE" variant="ghost" confirm="Delete this rule?">Delete</ActionButton>}
              </li>
            ))}
          </ul>
          {manage && <div className="border-t hairline p-5"><BucketRuleForm /></div>}
        </Card>
      </div>
    </>
  );
}
