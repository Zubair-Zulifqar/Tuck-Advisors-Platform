"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { COMPANY_KINDS, DEAL_STAGES } from "@tuck/shared";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";
import { ApiForm, str, tags } from "./actions";

export function CompanyForm() {
  const router = useRouter();
  return (
    <ApiForm path="/api/v1/companies" submitLabel="Add company" onDone={(d) => router.push(`/app/companies/${(d as { id: string }).id}`)}
      toBody={(f) => ({ name: str(f, "name"), website: str(f, "website"), industry: str(f, "industry"), kind: str(f, "kind"), headquarters: str(f, "headquarters"), tags: tags(f), customFields: {} })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Name *</span><input name="name" required maxLength={200} className="field" /></label>
        <label><span className="label">Website</span><input name="website" type="url" placeholder="https://" className="field" /></label>
        <label><span className="label">Industry</span><input name="industry" maxLength={120} className="field" /></label>
        <label><span className="label">Type</span><select name="kind" className="field" defaultValue="prospect">{COMPANY_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label><span className="label">Headquarters</span><input name="headquarters" className="field" /></label>
        <label><span className="label">Tags (comma separated)</span><input name="tags" className="field" /></label>
      </div>
    </ApiForm>
  );
}

export function ContactForm({ companies, defaultCompanyId }: { companies: { id: string; name: string }[]; defaultCompanyId?: string }) {
  return (
    <ApiForm path="/api/v1/contacts" submitLabel="Add contact"
      toBody={(f) => ({ firstName: str(f, "firstName"), lastName: str(f, "lastName"), email: str(f, "email"), emailStatus: f.get("manualVerified") === "on" ? "manually_verified" : "unverified", title: str(f, "title"), linkedinUrl: str(f, "linkedinUrl"), companyId: str(f, "companyId"), tags: tags(f), source: "manual" })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">First name *</span><input name="firstName" required className="field" /></label>
        <label><span className="label">Last name</span><input name="lastName" className="field" /></label>
        <label><span className="label">Email</span><input name="email" type="email" className="field" /></label>
        <label><span className="label">Title</span><input name="title" className="field" /></label>
        <label><span className="label">LinkedIn URL</span><input name="linkedinUrl" type="url" className="field" /></label>
        <label><span className="label">Company</span><select name="companyId" className="field" defaultValue={defaultCompanyId ?? ""}><option value="">—</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">Tags</span><input name="tags" className="field" /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="manualVerified" className="accent-brass" /> I have personally confirmed this email address</label>
    </ApiForm>
  );
}

export function DealForm({ companies }: { companies: { id: string; name: string; kind: string }[] }) {
  return (
    <ApiForm path="/api/v1/deals" submitLabel="Create deal"
      toBody={(f) => ({ name: str(f, "name"), targetCompanyId: str(f, "target"), buyerCompanyId: str(f, "buyer"), side: str(f, "side"), stage: str(f, "stage"), estimatedValueUsd: str(f, "value") ? Number(str(f, "value")) : undefined })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label">Deal name *</span><input name="name" required className="field" placeholder="Project …" /></label>
        <label><span className="label">Target</span><select name="target" className="field"><option value="">—</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="label">Buyer</span><select name="buyer" className="field"><option value="">—</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="label">Side</span><select name="side" className="field"><option value="sell_side">Sell-side</option><option value="buy_side">Buy-side</option></select></label>
        <label><span className="label">Stage</span><select name="stage" className="field">{DEAL_STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="label">Estimated value (USD, analyst estimate)</span><input name="value" type="number" min={0} className="field" /></label>
      </div>
    </ApiForm>
  );
}

export function TaskForm({ companyId, contactId, dealId }: { companyId?: string; contactId?: string; dealId?: string }) {
  return (
    <ApiForm path="/api/v1/tasks" submitLabel="Add task" className="flex flex-wrap items-end gap-2"
      toBody={(f) => ({ title: str(f, "title"), dueAt: str(f, "due") ? new Date(str(f, "due")!).toISOString() : undefined, companyId, contactId, dealId })}>
      <label className="min-w-[220px] flex-1"><span className="label">Follow-up</span><input name="title" required className="field" placeholder="Call back about…" /></label>
      <label><span className="label">Due</span><input name="due" type="datetime-local" className="field" /></label>
    </ApiForm>
  );
}

export function ActivityForm({ companyId, contactId, dealId }: { companyId?: string; contactId?: string; dealId?: string }) {
  return (
    <ApiForm path="/api/v1/activities" submitLabel="Log"
      toBody={(f) => ({ type: str(f, "type"), subject: str(f, "subject"), body: str(f, "body"), companyId, contactId, dealId, metadata: {} })}>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
        <select name="type" className="field"><option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="comment">Internal comment</option></select>
        <input name="subject" required placeholder="Summary" className="field" />
      </div>
      <textarea name="body" rows={3} placeholder="Details (optional)" className="field" />
    </ApiForm>
  );
}

export function CsvImport() {
  const router = useRouter();
  const [result, setResult] = useState<{ created: number; duplicates: number; invalid: number; results: { row: number; status: string; message?: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p className="muted">Columns: <code>name, domain, website, industry, kind, headquarters, tags</code> (tags separated by ;). Duplicates are detected by domain and name.</p>
      <input type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true); setErr(null);
        try {
          const r = await api<typeof result>("/api/v1/companies/import", { body: { csv: await file.text() } });
          setResult(r); router.refresh();
        } catch (x) { setErr(errorText(x)); } finally { setBusy(false); e.target.value = ""; }
      }} />
      {busy && <p>Importing…</p>}
      {err && <p className="text-rose-600">{err}</p>}
      {result && (
        <div>
          <p>{result.created} created · {result.duplicates} duplicates skipped · {result.invalid} invalid</p>
          <ul className="muted mt-1 max-h-40 overflow-auto text-xs">{result.results.filter((r) => r.status !== "created").map((r) => <li key={r.row}>Row {r.row}: {r.status} — {r.message}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function StageSelect({ dealId, stage }: { dealId: string; stage: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <select aria-label="Deal stage" defaultValue={stage} className="field !w-auto !py-1 text-xs" onChange={async (e) => {
        try { await api(`/api/v1/deals/${dealId}`, { method: "PATCH", body: { stage: e.target.value } }); router.refresh(); } catch (x) { setErr(errorText(x)); }
      }}>{DEAL_STAGES.map((s) => <option key={s}>{s}</option>)}</select>
      {err && <span className="block text-xs text-rose-600">{err}</span>}
    </span>
  );
}

export function TaskCheck({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  return <input type="checkbox" aria-label="Mark done" defaultChecked={done} className="h-4 w-4 accent-brass" onChange={async (e) => { await api(`/api/v1/tasks/${id}`, { method: "PATCH", body: { status: e.target.checked ? "done" : "open" } }); router.refresh(); }} />;
}

export function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant={open ? "ghost" : "primary"} onClick={() => setOpen(!open)}>{open ? "Close" : label}</Button>
      {open && <div className="surface mt-3 rounded-lg p-4">{children}</div>}
    </div>
  );
}
