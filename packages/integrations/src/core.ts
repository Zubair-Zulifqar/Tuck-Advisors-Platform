/**
 * Shared HTTP plumbing for every third-party adapter: typed errors, timeouts, retry with exponential
 * backoff (honouring Retry-After), and a token-bucket rate limiter. Adapters never swallow errors or
 * fabricate successful responses.
 */

export type IntegrationMode = "live" | "mock" | "disabled";

export interface IntegrationStatus {
  provider: string;
  mode: IntegrationMode;
  reason?: string;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public provider: string,
    public status?: number,
    public retryable = false,
    public details?: unknown,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}
export class MissingCredentialsError extends IntegrationError {
  constructor(provider: string, envVars: string[]) {
    super(`${provider} is not configured. Set ${envVars.join(", ")} to enable it.`, provider, 503, false);
    this.name = "MissingCredentialsError";
  }
}
export class AuthenticationError extends IntegrationError {
  constructor(provider: string, status = 401) {
    super(`${provider} rejected the configured credentials`, provider, status, false);
    this.name = "AuthenticationError";
  }
}
export class RateLimitError extends IntegrationError {
  constructor(
    provider: string,
    public retryAfterMs: number,
  ) {
    super(`${provider} rate limit reached; retry after ${Math.ceil(retryAfterMs / 1000)}s`, provider, 429, true);
    this.name = "RateLimitError";
  }
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
export const consoleLogger: Logger = {
  info: (m, meta) => console.info(JSON.stringify({ level: "info", msg: m, ...meta })),
  warn: (m, meta) => console.warn(JSON.stringify({ level: "warn", msg: m, ...meta })),
  error: (m, meta) => console.error(JSON.stringify({ level: "error", msg: m, ...meta })),
};
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Token bucket: `capacity` requests, refilled at `perSecond`. `take()` waits when empty. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private capacity: number,
    private perSecond: number,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
  }
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  async take(): Promise<void> {
    while (!this.tryTake()) await this.sleep(Math.ceil(((1 - this.tokens) / this.perSecond) * 1000));
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 300;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof IntegrationError ? e.retryable : e instanceof TypeError; // TypeError = network failure in fetch
      if (!retryable || attempt === max) throw e;
      const wait = e instanceof RateLimitError ? e.retryAfterMs : Math.min(opts.maxDelayMs ?? 10_000, base * 2 ** (attempt - 1));
      await sleep(wait);
    }
  }
  throw lastErr;
}

export interface HttpOptions {
  provider: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  limiter?: RateLimiter;
  retry?: RetryOptions;
  logger?: Logger;
}

function parseRetryAfter(h: string | null): number {
  if (!h) return 1000;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : 1000;
}

/** JSON HTTP call with timeout, rate limiting, retries and normalised errors. */
export async function httpJson<T = unknown>(url: string, o: HttpOptions): Promise<T> {
  const f = o.fetchImpl ?? fetch;
  const log = o.logger ?? silentLogger;
  return withRetry(async (attempt) => {
    await o.limiter?.take();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 20_000);
    let res: Response;
    try {
      const headers: Record<string, string> = { accept: "application/json", ...o.headers };
      let body: string | undefined;
      if (o.form) {
        headers["content-type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(o.form).toString();
      } else if (o.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(o.body);
      }
      res = await f(url, { method: o.method ?? (body ? "POST" : "GET"), headers, body, signal: ctrl.signal });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      log.warn("integration.network_error", { provider: o.provider, attempt, aborted });
      throw new IntegrationError(aborted ? `${o.provider} request timed out` : `${o.provider} network error`, o.provider, undefined, true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (res.ok) return json as T;
    log.warn("integration.http_error", { provider: o.provider, status: res.status, attempt });
    if (res.status === 401 || res.status === 403) throw new AuthenticationError(o.provider, res.status);
    if (res.status === 429) throw new RateLimitError(o.provider, parseRetryAfter(res.headers.get("retry-after")));
    throw new IntegrationError(
      `${o.provider} responded with HTTP ${res.status}`,
      o.provider,
      res.status,
      res.status >= 500,
      typeof json === "object" ? json : text.slice(0, 500),
    );
  }, o.retry);
}

export type Env = Record<string, string | undefined>;
