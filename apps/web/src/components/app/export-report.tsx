"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

/** Google Docs export only happens on an explicit click and with the user's own Google token. */
export function ExportReport({ id }: { id: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="secondary" onClick={async () => {
        if (!window.confirm("Export this report? A document will be created in your Google Drive only if Google is connected.")) return;
        try {
          const r = await api<{ exported: boolean; url?: string; text?: string; message?: string }>(`/api/v1/research/reports/${id}/export`, { body: { confirm: true } });
          if (r.exported && r.url) window.open(r.url, "_blank", "noopener");
          else { setMsg(r.message ?? null); setText(r.text ?? null); }
        } catch (e) { setMsg(errorText(e)); }
      }}>Export to Google Docs</Button>
      {msg && <span className="muted mt-1 max-w-xs text-xs">{msg}</span>}
      {text && <button className="mt-1 text-xs underline" onClick={() => navigator.clipboard.writeText(text)}>Copy report as text</button>}
    </span>
  );
}
