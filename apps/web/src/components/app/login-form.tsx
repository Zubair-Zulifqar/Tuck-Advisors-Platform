"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/client";
import { Button } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setErr(null);
        try {
          await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
          router.replace("/app");
          router.refresh();
        } catch (x) {
          setErr(errorText(x));
          setBusy(false);
        }
      }}
    >
      <label className="block"><span className="label">Email</span><input name="email" type="email" required autoComplete="username" className="field" /></label>
      <label className="block"><span className="label">Password</span><input name="password" type="password" required autoComplete="current-password" className="field" /></label>
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
