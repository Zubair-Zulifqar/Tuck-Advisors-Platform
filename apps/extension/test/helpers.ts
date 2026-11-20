import { vi } from "vitest";
import type { AuthStorage, KV } from "../src/lib/auth";

export function memoryKV(initial: Record<string, unknown> = {}): KV & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of keys) delete data[k];
    },
  };
}

export function memoryStorage(local: Record<string, unknown> = {}, session: Record<string, unknown> = {}) {
  return { local: memoryKV(local), session: memoryKV(session) } satisfies AuthStorage;
}

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const USER = { id: "u1", email: "analyst@example.test", name: "Test Analyst", organizationId: "o1", role: "analyst" };

export function tokens(n: number, expiresInMs = 15 * 60_000) {
  return { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: Date.now() + expiresInMs, user: USER };
}

/** Route-based fetch mock: handlers keyed by "METHOD /path". */
export function mockFetch(routes: Record<string, (init: RequestInit & { url: string }) => Response | Promise<Response>>) {
  return vi.fn(async (input: string, init: RequestInit = {}) => {
    const u = new URL(input);
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    const h = routes[key];
    if (!h) return json(404, { error: { message: `no route ${key}` } });
    return h({ ...init, url: input });
  });
}
