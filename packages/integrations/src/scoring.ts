import { fitScoreResult, type FitScoreResult, type MatrixModelInput, type ScoringFacts } from "@tuck/shared";
import { type Env, IntegrationError, type Logger, MissingCredentialsError, httpJson, silentLogger } from "./core";

export interface BucketRule {
  key: string;
  bucket: string;
  priority: number;
  conditions: { field: string; operator: "in" | "not_in" | "contains" | "gte" | "lte"; values: (string | number)[] }[];
}
export interface BucketResult {
  bucket: string | null;
  matchedRuleKey: string | null;
  explanation: string[];
}

/** HTTP client for the Python scoring service (services/ai-research). */
export class ScoringClient {
  constructor(
    private baseUrl: string,
    private token?: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
  ) {}
  private post<T>(path: string, body: unknown) {
    return httpJson<T>(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      provider: "scoring_service",
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      body,
      timeoutMs: 15_000,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
  }
  async score(model: MatrixModelInput & { version: number }, buyer: ScoringFacts, target: ScoringFacts): Promise<FitScoreResult> {
    const raw = await this.post<unknown>("/v1/score", { model, buyer, target });
    const parsed = fitScoreResult.safeParse(raw);
    if (!parsed.success) throw new IntegrationError("Scoring service returned an invalid result", "scoring_service", 502, false, parsed.error.issues);
    return parsed.data;
  }
  classifyBuyer(rules: BucketRule[], buyer: ScoringFacts) {
    return this.post<BucketResult>("/v1/classify-buyer", { rules, buyer });
  }
  async health() {
    return httpJson<{ status: string }>(`${this.baseUrl.replace(/\/$/, "")}/health`, { provider: "scoring_service", fetchImpl: this.fetchImpl, retry: { maxAttempts: 1 } });
  }
}

export function createScoringClient(env: Env, opts: { fetchImpl?: typeof fetch; logger?: Logger } = {}) {
  if (!env.SCORING_SERVICE_URL) throw new MissingCredentialsError("Scoring service", ["SCORING_SERVICE_URL"]);
  return new ScoringClient(env.SCORING_SERVICE_URL, env.SCORING_SERVICE_TOKEN, opts.fetchImpl, opts.logger);
}
