"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiForm, str, tags } from "./actions";

export function CampaignForm({ templates }: { templates: { id: string; name: string; subject: string; body: string }[] }) {
  const router = useRouter();
  const [tpl, setTpl] = useState(templates[0]);
  return (
    <ApiForm path="/api/v1/outreach/campaigns" submitLabel="Create draft campaign" onDone={(d) => router.push(`/app/outreach/${(d as { id: string }).id}`)}
      toBody={(f) => ({ name: str(f, "name"), subjectTemplate: str(f, "subject"), bodyTemplate: str(f, "body"), fromName: str(f, "fromName"), fromEmail: str(f, "fromEmail"), dailySendLimit: Number(str(f, "limit") ?? 50), segment: { tags: tags(f, "segmentTags"), companyKinds: f.getAll("kinds").map(String), requireVerifiedEmail: f.get("verified") === "on" } })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label">Campaign name</span><input name="name" required className="field" /></label>
        <label><span className="label">From name</span><input name="fromName" required className="field" /></label>
        <label><span className="label">From email (your verified sending domain)</span><input name="fromEmail" type="email" required className="field" /></label>
        {templates.length > 0 && <label className="sm:col-span-2"><span className="label">Start from template</span><select className="field" onChange={(e) => setTpl(templates.find((t) => t.id === e.target.value))}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <label className="sm:col-span-2"><span className="label">Subject</span><input key={`s${tpl?.id}`} name="subject" required defaultValue={tpl?.subject} className="field" /></label>
        <label className="sm:col-span-2"><span className="label">Body (an unsubscribe footer is appended automatically)</span><textarea key={`b${tpl?.id}`} name="body" required rows={7} defaultValue={tpl?.body} className="field" /></label>
        <label><span className="label">Segment: contact/company tags</span><input name="segmentTags" placeholder="demo, q3" className="field" /></label>
        <label><span className="label">Daily send limit</span><input name="limit" type="number" min={1} max={200} defaultValue={50} className="field" /></label>
        <fieldset className="sm:col-span-2 flex flex-wrap gap-3 text-sm"><legend className="label">Company types</legend>{["prospect", "target", "buyer", "client"].map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="kinds" value={k} className="accent-brass" />{k}</label>)}</fieldset>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked className="accent-brass" /> Only contacts with verified email addresses</label>
      </div>
    </ApiForm>
  );
}
