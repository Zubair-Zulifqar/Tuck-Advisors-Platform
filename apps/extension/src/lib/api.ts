import type { AuthManager } from "./auth";
import { AuthError } from "./errors";
import { httpJson, type FetchLike, type HttpOptions } from "./http";

/** Authenticated client for the Tuck platform. Retries exactly once after refreshing on 401. */
export class ApiClient {
  constructor(
    private auth: AuthManager,
    private fetchImpl: FetchLike,
  ) {}

  async request<T>(path: string, opts: Omit<HttpOptions, "token"> = {}): Promise<T> {
    if (!path.startsWith("/api/v1/")) throw new Error("Only /api/v1 endpoints may be called from the extension");
    const baseUrl = await this.auth.getBaseUrl();
    const token = await this.auth.getAccessToken();
    try {
      return await httpJson<T>(this.fetchImpl, baseUrl, path, { ...opts, token });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      const fresh = await this.auth.refresh();
      return httpJson<T>(this.fetchImpl, baseUrl, path, { ...opts, token: fresh });
    }
  }

  get<T>(path: string) {
    return this.request<T>(path, { method: "GET" });
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }
}
