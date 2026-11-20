"use client";

import { useState } from "react";
import type { CompanyRow } from "@tuck/db";
import { COMPANY_KINDS } from "@tuck/shared";
import { ApiForm, str, tags } from "./actions";

export function EditCompany({ company: c }: { company: CompanyRow }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-brass-600">Edit</button>;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal aria-label="Edit company">
      <div className="surface max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg p-5">
        <div className="mb-3 flex justify-between"><h2 className="font-semibold">Edit {c.name}</h2><button onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
        <ApiForm path={`/api/v1/companies/${c.id}`} method="PATCH" resetOnSuccess={false} onDone={() => setOpen(false)}
          toBody={(f) => ({ name: str(f, "name"), website: str(f, "website") ?? "", industry: str(f, "industry"), kind: str(f, "kind"), headquarters: str(f, "headquarters"), employeeRange: str(f, "employeeRange"), description: str(f, "description"), linkedinUrl: str(f, "linkedinUrl") ?? "", tags: tags(f) })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">Name</span><input name="name" defaultValue={c.name} className="field" /></label>
            <label><span className="label">Website</span><input name="website" defaultValue={c.website ?? ""} className="field" /></label>
            <label><span className="label">Industry</span><input name="industry" defaultValue={c.industry ?? ""} className="field" /></label>
            <label><span className="label">Type</span><select name="kind" defaultValue={c.kind} className="field">{COMPANY_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label><span className="label">HQ</span><input name="headquarters" defaultValue={c.headquarters ?? ""} className="field" /></label>
            <label><span className="label">Employees</span><select name="employeeRange" defaultValue={c.employee_range ?? ""} className="field"><option value="">—</option>{["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10000+"].map((r) => <option key={r}>{r}</option>)}</select></label>
            <label className="sm:col-span-2"><span className="label">LinkedIn URL</span><input name="linkedinUrl" defaultValue={c.linkedin_url ?? ""} className="field" /></label>
            <label className="sm:col-span-2"><span className="label">Tags</span><input name="tags" defaultValue={c.tags.join(", ")} className="field" /></label>
            <label className="sm:col-span-2"><span className="label">Description</span><textarea name="description" defaultValue={c.description ?? ""} rows={3} className="field" /></label>
          </div>
        </ApiForm>
      </div>
    </div>
  );
}
