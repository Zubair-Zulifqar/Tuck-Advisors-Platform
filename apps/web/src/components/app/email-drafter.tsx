"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Badge, Button } from "@/components/ui";

export function EmailDrafter({ contactId, email }: { contactId: string; email: string | null }) {
  const [intent, setIntent] = useState("follow_up");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const gen = useMutation({
    mutationFn: () => api<{ subject: string; body: string; followUpSuggestions: string[]; mock: boolean }>("/api/v1/communications/draft", { body: { contactId, intent, notes: notes || undefined } }),
    onSuccess: (d) => setDraft({ subject: d.subject, body: d.body }),
  });
  const mailto = draft && email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` : null;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <select value={intent} onChange={(e) => setIntent(e.target.value)} className="field max-w-[200px]" aria-label="Email intent">
          <option value="intro">Introduction</option><option value="follow_up">Follow-up</option><option value="meeting_request">Meeting request</option><option value="thank_you">Thank you</option><option value="custom">Custom</option>
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the draft (optional)" className="field flex-1" />
        <Button onClick={() => gen.mutate()} disabled={gen.isPending}>{gen.isPending ? "Drafting…" : "Draft email"}</Button>
      </div>
      {gen.error && <p className="text-rose-600">{errorText(gen.error)}</p>}
      {draft && (
        <div className="space-y-2">
          {gen.data?.mock && <Badge tone="warn">Template draft — no AI provider configured</Badge>}
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="field" aria-label="Subject" />
          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={8} className="field" aria-label="Body" />
          <div className="flex gap-2">
            {mailto && <a href={mailto} className="rounded-md bg-navy px-3.5 py-2 text-ivory dark:bg-ivory dark:text-navy">Open in my email client</a>}
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}>Copy</Button>
          </div>
        </div>
      )}
    </div>
  );
}
