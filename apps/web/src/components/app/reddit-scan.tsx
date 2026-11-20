"use client";

import { useState } from "react";
import { ApiForm, str } from "./actions";

export function RedditScan() {
  const [res, setRes] = useState<{ scanned: number; matched: number; saved: number; mock: boolean } | null>(null);
  return (
    <ApiForm path="/api/v1/reddit/scan" submitLabel="Search Reddit" resetOnSuccess={false} onDone={(d) => setRes(d as typeof res)} className="flex flex-wrap items-end gap-2"
      toBody={(f) => ({ query: str(f, "q"), subreddits: (str(f, "subs") ?? "").split(",").map((s) => s.trim().replace(/^r\//, "")).filter(Boolean) })}>
      <label className="min-w-[240px] flex-1"><span className="label">Search</span><input name="q" required defaultValue="selling my business" className="field" /></label>
      <label className="min-w-[240px]"><span className="label">Subreddits (optional)</span><input name="subs" placeholder="smallbusiness, SaaS" className="field" /></label>
      {res && <p className="muted w-full text-sm">Scanned {res.scanned} posts · {res.matched} with M&amp;A signals · {res.saved} saved{res.mock ? " (sample data)" : ""}</p>}
    </ApiForm>
  );
}
