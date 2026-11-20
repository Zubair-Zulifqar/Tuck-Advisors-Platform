"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

/** Calls an API endpoint then refreshes server components. Optional confirmation for consequential actions. */
export function ActionButton({ path, method = "POST", body, children, confirm, variant = "secondary", onDone, className }: {
  path: string; method?: string; body?: unknown; children: ReactNode; confirm?: string; variant?: "primary" | "secondary" | "ghost" | "danger" | "brass"; onDone?: (data: unknown) => void; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button type="button" variant={variant} disabled={busy} className={className}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setErr(null);
          try {
            const d = await api(path, { method, body: body ?? (method === "GET" ? undefined : {}) });
            onDone?.(d);
            router.refresh();
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}>
        {busy ? "Working…" : children}
      </Button>
      {err && <span role="alert" className="mt-1 max-w-xs text-xs text-rose-600">{err}</span>}
    </span>
  );
}

/** Generic form that POSTs/PATCHes its fields (via a mapper) and refreshes. */
export function ApiForm({ path, method = "POST", toBody, children, submitLabel = "Save", onDone, resetOnSuccess = true, className }: {
  path: string; method?: string; toBody: (f: FormData) => unknown; children: ReactNode; submitLabel?: string; onDone?: (data: unknown) => void; resetOnSuccess?: boolean; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className={className ?? "space-y-3"}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        setErr(null);
        try {
          const d = await api(path, { method, body: toBody(new FormData(form)) });
          if (resetOnSuccess) form.reset();
          onDone?.(d);
          router.refresh();
        } catch (x) {
          setErr(errorText(x));
        } finally {
          setBusy(false);
        }
      }}>
      {children}
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
export const tags = (f: FormData, k = "tags") => (str(f, k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
