"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/client";

export function RoleSelect({ userId, role, roles }: { userId: string; role: string; roles: string[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <select aria-label="Role" defaultValue={role} className="field !w-auto !py-1 text-xs" onChange={async (e) => { try { await api(`/api/v1/members/${userId}`, { method: "PATCH", body: { role: e.target.value } }); router.refresh(); } catch (x) { setErr(errorText(x)); } }}>
        {roles.map((r) => <option key={r}>{r}</option>)}
      </select>
      {err && <span className="block text-xs text-rose-600">{err}</span>}
    </span>
  );
}
