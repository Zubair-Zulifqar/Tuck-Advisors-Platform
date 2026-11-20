import type { Db } from "@tuck/db";
import {
  type EmailProvider,
  type Env,
  type ExternalCrmAdapter,
  type LlmProvider,
  type Logger,
  type RedditProvider,
  type ResearchProvider,
  ScoringClient,
  consoleLogger,
  createEmailProvider,
  createEnrichmentProvider,
  createExternalCrm,
  createLlmProvider,
  createRedditProvider,
  createResearchProvider,
  type EnrichmentProvider,
} from "@tuck/integrations";

export interface EngineDeps {
  db: Db;
  env: Env;
  llm: LlmProvider;
  research: ResearchProvider & { hasSearch?: boolean };
  enrichment: (preferred?: "apollo" | "rocketreach") => EnrichmentProvider;
  email: EmailProvider;
  reddit: RedditProvider;
  scoring: ScoringClient | null;
  externalCrm: ExternalCrmAdapter;
  logger: Logger;
  now: () => Date;
}

export function createEngineDeps(db: Db, env: Env, overrides: Partial<EngineDeps> = {}): EngineDeps {
  const logger = overrides.logger ?? consoleLogger;
  // Mock LLM/email providers are refused in production unless explicitly allowed (demos, e2e tests).
  const allowMock = env.NODE_ENV !== "production" || env.ALLOW_MOCK_PROVIDERS === "true";
  return {
    db,
    env,
    logger,
    llm: overrides.llm ?? createLlmProvider(env, { logger, allowMock }),
    research: createResearchProvider(env, { logger }),
    enrichment: (p) => createEnrichmentProvider(env, p, { logger }),
    email: overrides.email ?? createEmailProvider(env, { logger, allowMock }),
    reddit: createRedditProvider(env, { logger }),
    scoring: env.SCORING_SERVICE_URL ? new ScoringClient(env.SCORING_SERVICE_URL, env.SCORING_SERVICE_TOKEN, undefined, logger) : null,
    externalCrm: createExternalCrm(env, { logger }),
    now: () => new Date(),
    ...overrides,
  };
}
