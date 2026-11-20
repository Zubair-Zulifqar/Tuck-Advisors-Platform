"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACTIONS, APPROVAL_REQUIRED_ACTIONS, TRIGGERS, type AutomationInput } from "@tuck/shared";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

type Step = AutomationInput["actions"][number];
type Cond = AutomationInput["conditions"][number];

/** Visual builder: trigger → conditions → ordered action steps with delay / approval / error handling. */
export function AutomationBuilder() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<string>(TRIGGERS[0]);
  const [conds, setConds] = useState<Cond[]>([]);
  const [steps, setSteps] = useState<Step[]>([{ id: "step1", type: "task.create", params: { title: "Follow up" }, delaySeconds: 0, requiresApproval: false, continueOnError: false }]);
  const [err, setErr] = useState<string | null>(null);
  const setStep = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="space-y-4 text-sm">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Automation name" className="field" aria-label="Name" />
      <div className="rounded-md border hairline p-3">
        <p className="label">When</p>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="field" aria-label="Trigger">{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="rounded-md border hairline p-3">
        <p className="label">Only if (all conditions)</p>
        {conds.map((c, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_110px_1fr_auto] gap-2">
            <input value={c.path} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} placeholder="payload.kind" className="field" aria-label="Field path" />
            <select value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as Cond["op"] } : x)))} className="field">{["eq", "neq", "contains", "exists", "not_exists", "gt", "gte", "lt", "lte"].map((o) => <option key={o}>{o}</option>)}</select>
            <input value={String(c.value ?? "")} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value } : x)))} placeholder="value" className="field" aria-label="Value" />
            <button onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Remove condition">✕</button>
          </div>
        ))}
        <button className="text-xs underline" onClick={() => setConds([...conds, { path: "payload.", op: "eq", value: "" }])}>+ condition</button>
      </div>
      <div className="space-y-2">
        <p className="label">Then</p>
        {steps.map((s, i) => (
          <div key={i} className="rounded-md border hairline p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
              <select value={s.type} onChange={(e) => setStep(i, { type: e.target.value as Step["type"], requiresApproval: APPROVAL_REQUIRED_ACTIONS.includes(e.target.value as Step["type"]) || s.requiresApproval })} className="field" aria-label="Action">{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
              <input type="number" min={0} value={s.delaySeconds / 3600} onChange={(e) => setStep(i, { delaySeconds: Math.round(Number(e.target.value) * 3600) })} className="field" aria-label="Delay hours" title="Delay (hours)" />
            </div>
            <textarea value={JSON.stringify(s.params)} rows={2} onChange={(e) => { try { setStep(i, { params: JSON.parse(e.target.value) }); setErr(null); } catch { setErr("Step params must be valid JSON"); } }} className="field mt-2 font-mono text-xs" aria-label="Parameters JSON" />
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={s.requiresApproval} disabled={APPROVAL_REQUIRED_ACTIONS.includes(s.type)} onChange={(e) => setStep(i, { requiresApproval: e.target.checked })} className="accent-brass" /> Require human approval</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={s.continueOnError} onChange={(e) => setStep(i, { continueOnError: e.target.checked })} className="accent-brass" /> Continue on error</label>
              {steps.length > 1 && <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="underline">Remove step</button>}
            </div>
          </div>
        ))}
        <button className="text-xs underline" onClick={() => setSteps([...steps, { id: `step${steps.length + 1}`, type: "notify.member", params: { message: "" }, delaySeconds: 0, requiresApproval: false, continueOnError: false }])}>+ step</button>
      </div>
      {err && <p className="text-rose-600">{err}</p>}
      <Button disabled={!name} onClick={async () => {
        try {
          await api("/api/v1/automations", { body: { name, description: "", trigger: { type: trigger, config: {} }, conditions: conds, conditionMode: "all", actions: steps, retry: { maxAttempts: 3, backoffSeconds: 60, backoffMultiplier: 2 }, enabled: false } });
          setName(""); router.refresh();
        } catch (e) { setErr(errorText(e)); }
      }}>Save (paused)</Button>
    </div>
  );
}
