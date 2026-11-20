"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Badge, Button } from "@/components/ui";

const KINDS: [string, string][] = [
  ["business_overview", "Business overview"],
  ["positioning_statement", "Positioning statement"],
  ["capital_raise", "Capital raise detection"],
  ["acquisition_analysis", "Acquisition analysis"],
  ["similar_companies", "Similar companies"],
  ["buyer_classification", "Buyer bucket classification"],
  ["pre_call_notes", "Pre-call brief"],
  ["post_call_notes", "Post-call notes"],
];

type Job = { id: string; status: string; last_error: string | null; report: { id: string; title: string } | null };

export function ResearchLauncher({ companyId, contactId, kinds }: { companyId?: string; contactId?: string; kinds?: string[] }) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds?.[0] ?? "business_overview");
  const [transcript, setTranscript] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/research", { body: { kind, companyId, contactId, input: kind === "post_call_notes" ? { transcript } : {} } }),
    onSuccess: (j) => setJobId(j.id),
  });
  const job = useQuery({
    queryKey: ["job", jobId],
    enabled: !!jobId,
    queryFn: () => api<Job>(`/api/v1/research/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && ["succeeded", "failed"].includes(q.state.data.status) ? false : 2000),
  });
  const done = job.data?.status === "succeeded";
  if (done && job.data?.report) setTimeout(() => router.refresh(), 0);
  const options = KINDS.filter(([k]) => !kinds || kinds.includes(k));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Research type" value={kind} onChange={(e) => setKind(e.target.value)} className="field max-w-[260px]">
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Button variant="brass" disabled={start.isPending || (kind === "post_call_notes" && transcript.trim().length < 20)} onClick={() => { setJobId(null); start.mutate(); }}>
          {start.isPending ? "Queuing…" : "Run research"}
        </Button>
      </div>
      {kind === "post_call_notes" && (
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6} className="field" placeholder="Paste meeting notes or a transcript. Action items become tasks; CRM changes are suggested for your approval." />
      )}
      {start.error && <p className="text-sm text-rose-600">{errorText(start.error)}</p>}
      {jobId && (
        <div className="flex items-center gap-2 text-sm" role="status">
          <Badge tone={job.data?.status === "failed" ? "bad" : done ? "good" : "info"}>{job.data?.status ?? "queued"}</Badge>
          {!done && job.data?.status !== "failed" && <span className="muted">Researching… results appear automatically.</span>}
          {job.data?.status === "failed" && <span className="text-rose-600">{job.data.last_error}</span>}
          {done && job.data?.report && <Link className="underline" href={`/app/research/${job.data.report.id}`}>Open “{job.data.report.title}”</Link>}
        </div>
      )}
    </div>
  );
}

export function FitScoreForm({ companies, defaultTarget }: { companies: { id: string; name: string; kind: string }[]; defaultTarget?: string }) {
  const router = useRouter();
  const [buyer, setBuyer] = useState(companies.find((c) => c.kind === "buyer")?.id ?? "");
  const [target, setTarget] = useState(defaultTarget ?? companies.find((c) => c.kind === "target")?.id ?? "");
  const run = useMutation({
    mutationFn: () => api<{ score: { score: number | null; grade: string; explanation: string[] } }>("/api/v1/fit-scores", { body: { buyerCompanyId: buyer, targetCompanyId: target } }),
    onSuccess: () => router.refresh(),
  });
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label><span className="label">Buyer</span><select value={buyer} onChange={(e) => setBuyer(e.target.value)} className="field">{companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select></label>
        <label><span className="label">Target</span><select value={target} onChange={(e) => setTarget(e.target.value)} className="field">{companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}</select></label>
        <Button className="self-end" disabled={!buyer || !target || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Scoring…" : "Calculate"}</Button>
      </div>
      {run.error && <p className="text-rose-600">{errorText(run.error)}</p>}
      {run.data && (
        <div className="rounded-md bg-black/[.03] p-3 dark:bg-white/[.04]">
          <p className="font-semibold">{run.data.score.score === null ? "No score (insufficient data)" : `${run.data.score.score.toFixed(1)} / 100`} · {run.data.score.grade.replace("_", " ")}</p>
          <ul className="muted mt-1 list-disc pl-5">{run.data.score.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
