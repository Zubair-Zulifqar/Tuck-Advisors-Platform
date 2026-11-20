import { createPgliteDb, migrate, type Db } from "@tuck/db";
import { MockCrmAdapter, MockEmailProvider, MockEnrichmentProvider, MockLlmProvider, MockRedditProvider, silentLogger, type ResearchProvider } from "@tuck/integrations";
import type { FitScoreResult, ResearchSource } from "@tuck/shared";
import { createEngineDeps, type EngineDeps } from "../src";

export const ORG = "00000000-0000-4000-8000-0000000000aa";
export const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
export const ALICE = "00000000-0000-4000-8000-0000000000a1"; // owner
export const BEN = "00000000-0000-4000-8000-0000000000a2"; // admin
export const ctxAlice = { userId: ALICE, organizationId: ORG, role: "owner" as const };
export const ctxBen = { userId: BEN, organizationId: ORG, role: "admin" as const };

export async function setupDb(): Promise<Db> {
  const db = await createPgliteDb();
  await migrate(db);
  await db.exec(`
    insert into organizations(id, name, slug) values ('${ORG}', 'Tuck Test', 'tuck-test'), ('${OTHER_ORG}', 'Other', 'other');
    insert into users(id, email, name) values ('${ALICE}', 'alice@tuck.test', 'Alice'), ('${BEN}', 'ben@tuck.test', 'Ben');
    insert into memberships(organization_id, user_id, role) values ('${ORG}', '${ALICE}', 'owner'), ('${ORG}', '${BEN}', 'admin');
  `);
  return db;
}

export function source(url: string, excerpt: string, title = "Acme Health — clinic software"): ResearchSource {
  return { id: `src_${Buffer.from(url).toString("hex").slice(-10)}`, url, title, provider: "fake", retrievedAt: new Date().toISOString(), excerpt };
}

export class FakeResearch implements ResearchProvider {
  name = "fake-research";
  mock = true;
  hasSearch = true;
  calls: string[] = [];
  constructor(private pages: Record<string, ResearchSource> = {}, private searchResults: ResearchSource[] = []) {}
  async getContents(urls: string[]) {
    this.calls.push(...urls);
    return urls.map((u) => this.pages[new URL(u).hostname]).filter((x): x is ResearchSource => !!x);
  }
  async search() {
    return this.searchResults;
  }
  async findSimilar() {
    return this.searchResults;
  }
}

export function fakeScoring(result?: Partial<FitScoreResult>) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async score(model: { key: string; version: number }, buyer: unknown, target: unknown): Promise<FitScoreResult> {
        calls.push({ model, buyer, target });
        return {
          modelKey: model.key,
          modelVersion: model.version,
          score: 72.5,
          grade: "strong",
          confidence: 0.8,
          coverage: 0.9,
          cells: [{ criterionKey: "industry", label: "Industry overlap", weight: 20, score: 0.9, contribution: 18, rationale: "Both in healthcare software", evidence: [], missing: false }],
          exclusions: [],
          explanation: ["Overall fit 72.5/100 (strong)."],
          ...result,
        };
      },
      async classifyBuyer() {
        return { bucket: "Healthcare Platform", matchedRuleKey: "r1", explanation: ["matched"] };
      },
      async health() {
        return { status: "ok" };
      },
    },
  };
}

export function makeDeps(db: Db, overrides: Partial<EngineDeps> = {}): EngineDeps & { email: MockEmailProvider } {
  return createEngineDeps(db, { NODE_ENV: "test", APP_URL: "https://tuck.test" }, {
    logger: silentLogger,
    llm: new MockLlmProvider(),
    research: new FakeResearch(),
    enrichment: () => new MockEnrichmentProvider(),
    email: new MockEmailProvider(),
    reddit: new MockRedditProvider(),
    scoring: null,
    externalCrm: new MockCrmAdapter(),
    ...overrides,
  }) as EngineDeps & { email: MockEmailProvider };
}
