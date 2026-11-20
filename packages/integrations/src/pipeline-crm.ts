import { randomUUID } from "node:crypto";
import { type Env, type Logger, MissingCredentialsError, RateLimiter, httpJson, silentLogger } from "./core";

/**
 * Pipeline CRM adapter. Endpoints follow Pipeline CRM's public REST API v3
 * (https://app.pipelinecrm.com/api/docs): resources at /api/v3/{companies|people|deals}.json authenticated
 * with `api_key` (+ `app_key` for partner apps) query parameters. Custom-field ids are account-specific and
 * come from configuration (PIPELINE_CRM_FIT_SCORE_FIELD) — never hardcoded. Verify against your account's
 * API docs before enabling in production.
 */
export interface ExternalCompany {
  name: string;
  website?: string | null;
  description?: string | null;
}
export interface ExternalPerson {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  title?: string | null;
  companyExternalId?: string | null;
}
export interface ExternalCrmAdapter {
  readonly name: string;
  readonly mock: boolean;
  upsertCompany(c: ExternalCompany, externalId?: string | null): Promise<{ externalId: string }>;
  upsertPerson(p: ExternalPerson, externalId?: string | null): Promise<{ externalId: string }>;
  writeFitScore(companyExternalId: string, score: { value: number | null; grade: string; summary: string }): Promise<void>;
  testConnection(): Promise<{ ok: true }>;
}

export class PipelineCrmAdapter implements ExternalCrmAdapter {
  readonly name = "pipeline_crm";
  readonly mock = false;
  private limiter = new RateLimiter(5, 2);
  constructor(
    private cfg: { apiKey: string; appKey?: string; fitScoreFieldId?: string; fitGradeFieldId?: string; baseUrl?: string },
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}
  private url(path: string) {
    const q = new URLSearchParams({ api_key: this.cfg.apiKey });
    if (this.cfg.appKey) q.set("app_key", this.cfg.appKey);
    return `${this.cfg.baseUrl ?? "https://api.pipelinecrm.com/api/v3"}${path}?${q}`;
  }
  private req<T>(path: string, method: string, body?: unknown) {
    return httpJson<T>(this.url(path), { provider: "pipeline_crm", method, body, limiter: this.limiter, fetchImpl: this.fetchImpl, logger: this.logger });
  }
  async upsertCompany(c: ExternalCompany, externalId?: string | null) {
    const body = { company: { name: c.name, web: c.website ?? undefined, description: c.description ?? undefined } };
    const r = externalId
      ? await this.req<{ id: number }>(`/companies/${encodeURIComponent(externalId)}.json`, "PUT", body)
      : await this.req<{ id: number }>("/companies.json", "POST", body);
    return { externalId: String(r.id ?? externalId) };
  }
  async upsertPerson(p: ExternalPerson, externalId?: string | null) {
    const body = {
      person: {
        first_name: p.firstName,
        last_name: p.lastName ?? undefined,
        email: p.email ?? undefined,
        position: p.title ?? undefined,
        company_id: p.companyExternalId ? Number(p.companyExternalId) : undefined,
      },
    };
    const r = externalId
      ? await this.req<{ id: number }>(`/people/${encodeURIComponent(externalId)}.json`, "PUT", body)
      : await this.req<{ id: number }>("/people.json", "POST", body);
    return { externalId: String(r.id ?? externalId) };
  }
  async writeFitScore(companyExternalId: string, score: { value: number | null; grade: string; summary: string }) {
    if (!this.cfg.fitScoreFieldId) throw new MissingCredentialsError("Pipeline CRM fit score field", ["PIPELINE_CRM_FIT_SCORE_FIELD"]);
    const custom: Record<string, unknown> = { [this.cfg.fitScoreFieldId]: score.value };
    if (this.cfg.fitGradeFieldId) custom[this.cfg.fitGradeFieldId] = score.grade;
    await this.req(`/companies/${encodeURIComponent(companyExternalId)}.json`, "PUT", { company: { custom_fields: custom } });
  }
  async testConnection() {
    await this.req("/companies.json", "GET");
    return { ok: true as const };
  }
}

/** In-memory adapter for local development and tests. Records every write for inspection. */
export class MockCrmAdapter implements ExternalCrmAdapter {
  readonly name = "pipeline_crm_mock";
  readonly mock = true;
  companies = new Map<string, ExternalCompany & { fit?: unknown }>();
  people = new Map<string, ExternalPerson>();
  async upsertCompany(c: ExternalCompany, externalId?: string | null) {
    const id = externalId ?? `mock_${randomUUID().slice(0, 8)}`;
    this.companies.set(id, { ...this.companies.get(id), ...c });
    return { externalId: id };
  }
  async upsertPerson(p: ExternalPerson, externalId?: string | null) {
    const id = externalId ?? `mock_${randomUUID().slice(0, 8)}`;
    this.people.set(id, p);
    return { externalId: id };
  }
  async writeFitScore(companyExternalId: string, score: { value: number | null; grade: string; summary: string }) {
    const c = this.companies.get(companyExternalId);
    if (!c) throw new Error(`Mock CRM company ${companyExternalId} not found`);
    c.fit = score;
  }
  async testConnection() {
    return { ok: true as const };
  }
}

export function createExternalCrm(env: Env, opts: { fetchImpl?: typeof fetch; logger?: Logger } = {}): ExternalCrmAdapter {
  if (env.PIPELINE_CRM_API_KEY)
    return new PipelineCrmAdapter(
      {
        apiKey: env.PIPELINE_CRM_API_KEY,
        appKey: env.PIPELINE_CRM_APP_KEY,
        fitScoreFieldId: env.PIPELINE_CRM_FIT_SCORE_FIELD,
        fitGradeFieldId: env.PIPELINE_CRM_FIT_GRADE_FIELD,
        baseUrl: env.PIPELINE_CRM_BASE_URL,
      },
      opts.fetchImpl,
      opts.logger,
    );
  return new MockCrmAdapter();
}
