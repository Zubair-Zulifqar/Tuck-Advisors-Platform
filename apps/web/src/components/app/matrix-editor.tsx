"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SIGNALS, type MatrixModelInput } from "@tuck/shared";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";
import { ApiForm, str } from "./actions";

export function MatrixEditor({ model }: { model: MatrixModelInput }) {
  const router = useRouter();
  const [m, setM] = useState<MatrixModelInput>(model);
  const [msg, setMsg] = useState<string | null>(null);
  const total = m.criteria.reduce((s, c) => s + c.weight, 0);
  const upd = (i: number, patch: Partial<MatrixModelInput["criteria"][number]>) => setM({ ...m, criteria: m.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-4 text-sm">
      <table className="w-full">
        <thead><tr className="muted text-left text-xs uppercase"><th className="py-1">Criterion</th><th>Signal</th><th>Weight</th><th>Share</th><th>Required</th><th /></tr></thead>
        <tbody>
          {m.criteria.map((c, i) => (
            <tr key={i} className="border-t hairline">
              <td className="py-1.5 pr-2"><input value={c.label} onChange={(e) => upd(i, { label: e.target.value })} className="field !py-1" aria-label="Label" /></td>
              <td className="pr-2"><select value={c.signal} onChange={(e) => upd(i, { signal: e.target.value as never })} className="field !py-1" aria-label="Signal">{SIGNALS.map((s) => <option key={s}>{s}</option>)}</select></td>
              <td className="pr-2"><input type="number" min={0} max={100} value={c.weight} onChange={(e) => upd(i, { weight: Number(e.target.value) })} className="field !w-20 !py-1" aria-label="Weight" /></td>
              <td className="muted tabular-nums">{total ? ((c.weight / total) * 100).toFixed(0) : 0}%</td>
              <td><input type="checkbox" checked={c.required} onChange={(e) => upd(i, { required: e.target.checked })} className="accent-brass" aria-label="Required" /></td>
              <td><button className="muted text-xs" onClick={() => setM({ ...m, criteria: m.criteria.filter((_, j) => j !== i) })}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="ghost" onClick={() => setM({ ...m, criteria: [...m.criteria, { key: `c${Date.now().toString(36)}`, label: "New criterion", signal: "strategic_fit", weight: 5, required: false, params: {} }] })}>+ Add criterion</Button>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="label">Strong ≥</span><input type="number" value={m.thresholds.strong} onChange={(e) => setM({ ...m, thresholds: { ...m.thresholds, strong: Number(e.target.value) } })} className="field" /></label>
        <label><span className="label">Moderate ≥</span><input type="number" value={m.thresholds.moderate} onChange={(e) => setM({ ...m, thresholds: { ...m.thresholds, moderate: Number(e.target.value) } })} className="field" /></label>
        <label><span className="label">Min data coverage</span><input type="number" step="0.05" min={0} max={1} value={m.minCoverage} onChange={(e) => setM({ ...m, minCoverage: Number(e.target.value) })} className="field" /></label>
      </div>
      <details><summary className="cursor-pointer text-xs underline">Exclusion rules ({m.exclusions.length}) — edit JSON</summary>
        <textarea defaultValue={JSON.stringify(m.exclusions, null, 2)} rows={6} className="field mt-2 font-mono text-xs" onBlur={(e) => { try { setM({ ...m, exclusions: JSON.parse(e.target.value) }); setMsg(null); } catch { setMsg("Exclusions must be valid JSON"); } }} />
      </details>
      {msg && <p className="text-rose-600">{msg}</p>}
      <Button onClick={async () => { try { const r = await api<{ version: number }>("/api/v1/matrix", { body: m }); setMsg(`Published version ${r.version}`); router.refresh(); } catch (e) { setMsg(errorText(e)); } }}>Publish new version</Button>
    </div>
  );
}

export function BucketRuleForm() {
  return (
    <ApiForm path="/api/v1/bucket-rules" submitLabel="Add rule"
      toBody={(f) => ({ bucket: str(f, "bucket"), priority: Number(str(f, "priority") ?? 50), description: str(f, "description"), conditions: [{ field: str(f, "field"), operator: str(f, "operator"), values: (str(f, "values") ?? "").split(",").map((v) => v.trim()).filter(Boolean).map((v) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : v)) }] })}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="bucket" required placeholder="Bucket name" className="field" />
        <input name="priority" type="number" defaultValue={50} className="field" aria-label="Priority" />
        <select name="field" className="field">{["industry", "businessModel", "geographies", "tags", "employeeCount", "strategicThemes", "products", "customerSegments"].map((x) => <option key={x}>{x}</option>)}</select>
        <select name="operator" className="field">{["contains", "in", "not_in", "gte", "lte"].map((x) => <option key={x}>{x}</option>)}</select>
        <input name="values" required placeholder="Values, comma separated" className="field sm:col-span-2" />
      </div>
    </ApiForm>
  );
}
