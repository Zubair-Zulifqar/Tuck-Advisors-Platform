"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { ApiForm, str } from "./actions";

type M = { id: string; to_email: string; subject: string; body: string; status: string; error: string | null; contact_name: string };

export function MessageReview({ campaignId, messages, editable }: { campaignId: string; messages: M[]; editable: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!messages.length) return <p className="muted p-5 text-sm">No messages yet — generate them from the segment.</p>;
  return (
    <ul className="divide-y divide-[var(--border)] text-sm">
      {messages.map((m) => (
        <li key={m.id} className="px-5 py-3">
          <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
            <span><span className="font-medium">{m.contact_name}</span> <span className="muted">&lt;{m.to_email}&gt;</span><span className="block">{m.subject}</span></span>
            <span className="flex items-center gap-2">{m.error && <Badge tone="warn">{m.status === "sent" ? "simulated" : "needs fix"}</Badge>}<Badge tone={m.status === "replied" ? "good" : m.status === "bounced" || m.status === "failed" ? "bad" : "neutral"}>{m.status}</Badge></span>
          </button>
          {open === m.id && (
            <div className="mt-3">
              {m.error && <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">{m.error}</p>}
              {editable && m.status === "draft" ? (
                <ApiForm path={`/api/v1/outreach/campaigns/${campaignId}/edit-message`} resetOnSuccess={false} submitLabel="Save message" toBody={(f) => ({ messageId: m.id, subject: str(f, "subject"), text: str(f, "text") })}>
                  <input name="subject" defaultValue={m.subject} className="field" />
                  <textarea name="text" defaultValue={m.body} rows={9} className="field" />
                </ApiForm>
              ) : <pre className="muted whitespace-pre-wrap font-sans">{m.body}</pre>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
