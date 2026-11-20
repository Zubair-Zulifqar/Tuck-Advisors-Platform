"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

export function LeadForm({ defaultInterest, analysisId, compact }: { defaultInterest?: string; analysisId?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    try {
      await api("/api/public/leads", {
        body: {
          name: f.get("name"),
          email: f.get("email"),
          company: f.get("company") || undefined,
          interest: f.get("interest"),
          message: f.get("message") || undefined,
          analysisId,
          consent: f.get("consent") === "on",
          website: f.get("website") || undefined,
        },
      });
      setState("done");
    } catch (err) {
      setError(errorText(err));
      setState("idle");
    }
  }

  if (state === "done")
    return (
      <div role="status" className="surface rounded-lg p-6">
        <p className="font-serif text-xl">Thank you — we&apos;ve received your note.</p>
        <p className="muted mt-2 text-sm">A partner will be in touch within one business day.</p>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="surface space-y-4 rounded-lg p-6" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Name</span>
          <input name="name" required maxLength={120} className="field" autoComplete="name" />
        </label>
        <label className="block">
          <span className="label">Work email</span>
          <input name="email" type="email" required maxLength={254} className="field" autoComplete="email" />
        </label>
        <label className="block">
          <span className="label">Company</span>
          <input name="company" maxLength={200} className="field" autoComplete="organization" />
        </label>
        <label className="block">
          <span className="label">I&apos;m interested in</span>
          <select name="interest" defaultValue={defaultInterest ?? (analysisId ? "analyzer" : "general")} className="field">
            <option value="sell_side">Selling or recapitalising</option>
            <option value="buy_side">Acquiring companies</option>
            <option value="analyzer">Discussing my analyzer results</option>
            <option value="general">Something else</option>
          </select>
        </label>
      </div>
      {!compact && (
        <label className="block">
          <span className="label">How can we help?</span>
          <textarea name="message" rows={5} maxLength={4000} className="field" />
        </label>
      )}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1 accent-brass" />
        <span className="muted">I agree that Tuck Advisors may contact me about this inquiry. See our <a href="/privacy" className="underline">privacy policy</a>.</span>
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <Button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send inquiry"}</Button>
    </form>
  );
}
