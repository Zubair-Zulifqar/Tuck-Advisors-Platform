"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Info } from "lucide-react";
import { useState } from "react";
import type { AnalyzerReport, Claim } from "@tuck/shared";
import { api, errorText } from "@/lib/client";
import { Badge, Button, Provenance } from "@/components/ui";
import { LeadForm } from "./lead-form";

function normalizeUrl(v: string) {
  const s = v.trim();
  return s && !/^https?:\/\//i.test(s) ? `https://${s}` : s;
}

export function Analyzer() {
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (body: { targetUrl: string; buyerUrl: string; saveConsent: boolean; email?: string }) => api<{ report: AnalyzerReport; saved: boolean }>("/api/public/analyze", { body }),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const targetUrl = normalizeUrl(String(f.get("target") ?? ""));
    const buyerUrl = normalizeUrl(String(f.get("buyer") ?? ""));
    try {
      new URL(targetUrl);
      new URL(buyerUrl);
    } catch {
      setFormError("Please enter two valid company website addresses.");
      return;
    }
    if (targetUrl === buyerUrl) return setFormError("Target and buyer must be different companies.");
    setFormError(null);
    run.mutate({ targetUrl, buyerUrl, saveConsent: consent, email: consent ? String(f.get("email") || "") || undefined : undefined });
  }

  return (
    <div className="space-y-10">
      <form onSubmit={submit} className="surface grid gap-4 rounded-xl p-6 shadow-card md:grid-cols-[1fr_1fr_auto] md:items-end" aria-describedby="analyzer-disclaimer">
        <label className="block">
          <span className="label">Target company website</span>
          <input name="target" required placeholder="targetcompany.com" className="field" inputMode="url" />
        </label>
        <label className="block">
          <span className="label">Potential buyer website</span>
          <input name="buyer" required placeholder="acquirer.com" className="field" inputMode="url" />
        </label>
        <Button type="submit" variant="brass" disabled={run.isPending} className="h-[38px]">
          {run.isPending ? "Analyzing…" : "Analyze fit"}
        </Button>
        <div className="md:col-span-3 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 accent-brass" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="muted">Save this analysis so Tuck Advisors can discuss it with me (optional). Analyses are deleted after 180 days.</span>
          </label>
          {consent && <input name="email" type="email" placeholder="Your email (optional)" className="field max-w-sm" />}
          <p id="analyzer-disclaimer" className="muted flex items-start gap-2 text-xs">
            <Info size={14} className="mt-0.5 shrink-0" />
            Preliminary analysis from public information and AI interpretation. Not financial, legal, investment or valuation advice.
          </p>
        </div>
        {(formError || run.error) && (
          <p role="alert" className="md:col-span-3 text-sm text-rose-600">{formError ?? errorText(run.error)}</p>
        )}
      </form>

      {run.isPending && (
        <div className="surface animate-pulse rounded-xl p-8 text-center text-sm" role="status">
          Retrieving public information and scoring strategic fit… this can take up to a minute.
        </div>
      )}
      {run.data && <Report report={run.data.report} saved={run.data.saved} />}
    </div>
  );
}

function ClaimLine({ c, sources }: { c: Claim; sources: AnalyzerReport["sources"] }) {
  return (
    <li className="flex flex-col gap-1 border-b hairline py-2.5 last:border-0 sm:flex-row sm:items-start sm:gap-3">
      <div className="shrink-0 pt-0.5"><Provenance p={c.provenance} /></div>
      <p className={`text-sm leading-relaxed ${c.provenance === "unknown" ? "muted italic" : ""}`}>
        {c.text}
        {c.sourceIds.map((id) => {
          const i = sources.findIndex((s) => s.id === id);
          return i >= 0 ? <a key={id} href={`#src-${id}`} className="ml-1 text-xs text-brass-600 align-super">[{i + 1}]</a> : null;
        })}
      </p>
    </li>
  );
}

function ClaimList({ title, items, sources }: { title: string; items: Claim[]; sources: AnalyzerReport["sources"] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="font-serif text-lg font-semibold">{title}</h4>
      <ul className="mt-2">{items.map((c, i) => <ClaimLine key={i} c={c} sources={sources} />)}</ul>
    </div>
  );
}

function Report({ report, saved }: { report: AnalyzerReport; saved: boolean }) {
  const fit = report.fit;
  const gradeTone = { strong: "good", moderate: "info", weak: "warn", excluded: "bad", insufficient_data: "neutral" } as const;
  return (
    <article className="space-y-8" aria-label="Analysis report">
      {report.providers.mock && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Running without an AI provider: profiles use deterministic extraction from retrieved pages only. Assessments are limited.
        </div>
      )}
      <div className="surface grid gap-6 rounded-xl p-6 shadow-card md:grid-cols-[220px_1fr]">
        <div className="text-center md:border-r md:hairline md:pr-6">
          <p className="label">AI Fit Score</p>
          <p className="font-serif text-6xl font-semibold tabular-nums">{fit.score === null ? "—" : Math.round(fit.score)}</p>
          <Badge tone={gradeTone[fit.grade]}>{fit.grade.replace("_", " ")}</Badge>
          <p className="muted mt-3 text-xs">Confidence {(fit.confidence * 100).toFixed(0)}% · Data coverage {(fit.coverage * 100).toFixed(0)}%</p>
          <p className="muted text-xs">Model {fit.modelKey} v{fit.modelVersion}</p>
        </div>
        <div>
          <h3 className="font-serif text-xl font-semibold">{report.buyer.name} acquiring {report.target.name}</h3>
          <ul className="muted mt-3 space-y-1 text-sm">{fit.explanation.map((e, i) => <li key={i}>• {e}</li>)}</ul>
          {fit.cells.length > 0 && (
            <div className="mt-5 space-y-2.5">
              {fit.cells.map((c) => (
                <div key={c.criterionKey}>
                  <div className="flex justify-between text-sm"><span>{c.label} <span className="muted text-xs">(weight {c.weight})</span></span><span className="tabular-nums">{c.missing || c.score === null ? <span className="muted italic">no data</span> : `${Math.round(c.score * 100)}`}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10"><div className="h-1.5 rounded-full bg-brass" style={{ width: `${(c.score ?? 0) * 100}%` }} /></div>
                  <p className="muted mt-0.5 text-xs">{c.rationale}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[report.target, report.buyer].map((p, i) => (
          <div key={i} className="surface rounded-xl p-6">
            <p className="eyebrow">{i === 0 ? "Target" : "Buyer"}</p>
            <h3 className="mt-1 font-serif text-xl font-semibold">{p.name}</h3>
            <a href={p.url} rel="noopener noreferrer nofollow" target="_blank" className="muted inline-flex items-center gap-1 text-xs">{p.url} <ExternalLink size={12} /></a>
            <ul className="mt-3">
              {([["Overview", p.overview], ["Industry", p.industry], ["Business model", p.businessModel], ["Positioning", p.marketPositioning], ["Geography", p.geography], ["Revenue indicators", p.revenueIndicators]] as const).map(([l, c]) => (
                <li key={l} className="border-b hairline py-2 last:border-0">
                  <div className="flex items-center justify-between gap-2"><span className="label !mb-0">{l}</span><Provenance p={c.provenance} /></div>
                  <p className={`mt-1 text-sm ${c.provenance === "unknown" ? "muted italic" : ""}`}>{c.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="surface grid gap-8 rounded-xl p-6 md:grid-cols-2">
        <ClaimList title="Strategic fit" items={report.strategicFit} sources={report.sources} />
        <ClaimList title="Synergies" items={report.synergies} sources={report.sources} />
        <ClaimList title="Market expansion" items={report.marketExpansion} sources={report.sources} />
        <ClaimList title="Acquisition rationale" items={report.acquisitionRationale} sources={report.sources} />
        <ClaimList title="Risk factors" items={report.risks} sources={report.sources} />
        <ClaimList title="Considerations" items={report.considerations} sources={report.sources} />
      </div>

      <div className="surface rounded-xl p-6">
        <h4 className="font-serif text-lg font-semibold">Sources</h4>
        {report.sources.length === 0 ? (
          <p className="muted mt-2 text-sm">No public sources could be retrieved.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {report.sources.map((s, i) => (
              <li key={s.id} id={`src-${s.id}`} className="flex gap-2">
                <span className="muted tabular-nums">{i + 1}.</span>
                <span><a href={s.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">{s.title || s.url}</a> <span className="muted text-xs">· {s.provider} · retrieved {new Date(s.retrievedAt).toLocaleString()}</span></span>
              </li>
            ))}
          </ol>
        )}
        <p className="muted mt-6 border-t hairline pt-4 text-xs leading-relaxed">{report.disclaimer}</p>
      </div>

      <div className="grid gap-6 rounded-xl bg-navy p-6 text-ivory md:grid-cols-[1fr_1.4fr] md:p-8">
        <div>
          <p className="eyebrow !text-brass-400">Next step</p>
          <h3 className="mt-2 font-serif text-2xl">Want a partner&apos;s view?</h3>
          <p className="mt-2 text-sm text-ivory/70">We&apos;ll review this analysis with you, add proprietary buyer insight and outline realistic options. {saved ? "Your analysis has been saved for this conversation." : ""}</p>
        </div>
        <div className="text-[var(--text)]"><LeadForm defaultInterest="analyzer" analysisId={report.id} compact /></div>
      </div>
    </article>
  );
}
