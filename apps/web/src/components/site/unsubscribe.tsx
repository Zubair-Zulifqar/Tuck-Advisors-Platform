"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

export function UnsubscribeButton(p: { token?: string; email?: string; organizationId?: string }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = !!p.token || (!!p.email && !!p.organizationId);
  if (!valid) return <p className="muted">This unsubscribe link is incomplete. Reply &quot;unsubscribe&quot; to the email instead.</p>;
  if (done) return <p role="status">You have been unsubscribed.</p>;
  return (
    <div className="space-y-3">
      <Button onClick={async () => { try { await api("/api/public/unsubscribe", { body: p.token ? { token: p.token } : { email: p.email, organizationId: p.organizationId } }); setDone(true); } catch (e) { setErr(errorText(e)); } }}>Unsubscribe</Button>
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}
