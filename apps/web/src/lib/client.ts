"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Same-origin JSON client for the internal app (session cookie; CSRF enforced via Origin on the server). */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  return json?.data as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details as { issues?: string[]; duplicates?: { name: string }[] } | { path: string; message: string }[] | undefined;
    if (Array.isArray(d)) return `${e.message}: ${d.map((x) => `${x.path || "input"} — ${x.message}`).join("; ")}`;
    if (d && "issues" in d && d.issues) return `${e.message}: ${d.issues.join("; ")}`;
    if (d && "duplicates" in d && d.duplicates) return `${e.message}: ${d.duplicates.map((x) => x.name).join(", ")}`;
    return e.message;
  }
  return (e as Error)?.message ?? "Something went wrong";
}
