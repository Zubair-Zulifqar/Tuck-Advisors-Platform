import { extensionTokenResponse, type ExtensionTokenResponse } from "@tuck/shared";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./config";
import { AuthError, NetworkError } from "./errors";
import { httpJson, type FetchLike } from "./http";

export interface KV {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface AuthStorage {
  /** chrome.storage.session — in memory, cleared when the browser closes, not exposed to content scripts. */
  session: KV;
  /** chrome.storage.local — persists the (revocable, rotating) refresh token and non-secret settings. */
  local: KV;
}

export function chromeAuthStorage(): AuthStorage {
  return { session: chrome.storage.session as unknown as KV, local: chrome.storage.local as unknown as KV };
}

export type User = ExtensionTokenResponse["user"];
export type AuthState = "signed_in" | "signed_out" | "expired";
export interface AuthStatus {
  state: AuthState;
  user: User | null;
  baseUrl: string;
}

const SKEW_MS = 30_000;

/**
 * Owns the extension session. Only platform-issued session tokens are stored — never third-party
 * integration credentials (Apollo, Gmail, OpenAI keys etc. live server-side only).
 */
export class AuthManager {
  private refreshing: Promise<string> | null = null;

  constructor(
    private storage: AuthStorage,
    private fetchImpl: FetchLike,
  ) {}

  async getBaseUrl(): Promise<string> {
    const { baseUrl } = await this.storage.local.get(["baseUrl"]);
    return typeof baseUrl === "string" && baseUrl ? baseUrl : DEFAULT_BASE_URL;
  }

  async setBaseUrl(raw: string): Promise<string> {
    const baseUrl = normalizeBaseUrl(raw);
    const current = await this.getBaseUrl();
    if (current !== baseUrl) await this.clear(false); // tokens are bound to a backend
    await this.storage.local.set({ baseUrl });
    return baseUrl;
  }

  async status(): Promise<AuthStatus> {
    const [{ refreshToken, user, sessionExpired }, baseUrl] = await Promise.all([
      this.storage.local.get(["refreshToken", "user", "sessionExpired"]),
      this.getBaseUrl(),
    ]);
    if (typeof refreshToken === "string" && refreshToken) return { state: "signed_in", user: (user as User) ?? null, baseUrl };
    return { state: sessionExpired ? "expired" : "signed_out", user: null, baseUrl };
  }

  async login(email: string, password: string): Promise<User> {
    const baseUrl = await this.getBaseUrl();
    const data = await httpJson<unknown>(this.fetchImpl, baseUrl, "/api/extension/auth/login", { body: { email, password } }).catch((e) => {
      if (e instanceof AuthError) throw new AuthError("Incorrect email or password.");
      throw e;
    });
    const tokens = extensionTokenResponse.parse(data);
    await this.store(tokens);
    return tokens.user;
  }

  /** Returns a valid access token, refreshing if needed. Throws AuthError when signed out/expired. */
  async getAccessToken(): Promise<string> {
    const { accessToken, accessExpiresAt } = await this.storage.session.get(["accessToken", "accessExpiresAt"]);
    if (typeof accessToken === "string" && typeof accessExpiresAt === "number" && accessExpiresAt - SKEW_MS > Date.now()) return accessToken;
    return this.refresh();
  }

  /** Single-flight refresh: concurrent callers share one network round-trip (refresh tokens rotate). */
  refresh(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const { refreshToken } = await this.storage.local.get(["refreshToken"]);
    if (typeof refreshToken !== "string" || !refreshToken) throw new AuthError("Please sign in to the Tuck platform.");
    const baseUrl = await this.getBaseUrl();
    try {
      const tokens = extensionTokenResponse.parse(
        await httpJson<unknown>(this.fetchImpl, baseUrl, "/api/extension/auth/refresh", { body: { refreshToken } }),
      );
      await this.store(tokens);
      return tokens.accessToken;
    } catch (e) {
      if (e instanceof NetworkError) throw e; // keep the session; we may simply be offline
      await this.clear(true);
      throw e instanceof AuthError ? e : new AuthError();
    }
  }

  async logout(): Promise<void> {
    const [{ refreshToken }, baseUrl] = await Promise.all([this.storage.local.get(["refreshToken"]), this.getBaseUrl()]);
    try {
      if (typeof refreshToken === "string" && refreshToken) {
        await httpJson(this.fetchImpl, baseUrl, "/api/extension/auth/logout", { body: { refreshToken }, timeoutMs: 5000 });
      }
    } catch {
      /* best effort — local tokens are cleared regardless */
    } finally {
      await this.clear(false);
    }
  }

  private async store(t: ExtensionTokenResponse) {
    await this.storage.session.set({ accessToken: t.accessToken, accessExpiresAt: t.expiresAt });
    await this.storage.local.set({ refreshToken: t.refreshToken, user: t.user, sessionExpired: false });
  }

  private async clear(expired: boolean) {
    await this.storage.session.remove(["accessToken", "accessExpiresAt"]);
    await this.storage.local.remove(["refreshToken", "user"]);
    await this.storage.local.set({ sessionExpired: expired });
  }
}
