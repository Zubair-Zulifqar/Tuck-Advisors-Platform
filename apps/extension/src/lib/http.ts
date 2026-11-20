import { REQUEST_TIMEOUT_MS } from "./config";
import { ApiError, AuthError, NetworkError } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

/** One HTTP round-trip to the Tuck backend using the `{data}` / `{error}` envelope. */
export async function httpJson<T>(fetchImpl: FetchLike, baseUrl: string, path: string, opts: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json", "X-Tuck-Client": "extension" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    res = await fetchImpl(new URL(path, baseUrl).toString(), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError" || controller.signal.aborted;
    throw new NetworkError(aborted ? "The Tuck platform did not respond in time." : "Could not reach the Tuck platform. Check your connection and platform URL.", aborted);
  } finally {
    clearTimeout(timer);
  }

  let payload: { data?: T; error?: { message?: string; details?: unknown } } = {};
  const text = await res.text().catch(() => "");
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError("The platform returned an unexpected response.", res.status);
    }
  }
  if (res.status === 401) throw new AuthError(payload.error?.message);
  if (!res.ok) throw new ApiError(payload.error?.message ?? `Request failed (${res.status})`, res.status, payload.error?.details);
  return payload.data as T;
}
