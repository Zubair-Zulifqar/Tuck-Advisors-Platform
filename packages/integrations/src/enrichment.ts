import { type Env, type Logger, RateLimiter, httpJson, silentLogger } from "./core";

export interface EnrichmentQuery {
  firstName: string;
  lastName?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
}

export interface EnrichmentResult {
  provider: string;
  found: boolean;
  email: string | null;
  /** true ONLY when the provider itself reports the address as verified/deliverable. */
  emailVerified: boolean;
  emailStatusRaw: string | null;
  title: string | null;
  linkedinUrl: string | null;
  mock: boolean;
}

export interface EnrichmentProvider {
  readonly name: "apollo" | "rocketreach" | "mock";
  readonly mock: boolean;
  enrichPerson(q: EnrichmentQuery): Promise<EnrichmentResult>;
}

/** Apollo People Enrichment (POST /api/v1/people/match). Does not request personal emails. */
export class ApolloProvider implements EnrichmentProvider {
  readonly name = "apollo" as const;
  readonly mock = false;
  private limiter = new RateLimiter(5, 1);
  constructor(
    private apiKey: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
    private baseUrl = "https://api.apollo.io/api/v1",
  ) {}
  async enrichPerson(q: EnrichmentQuery): Promise<EnrichmentResult> {
    const res = await httpJson<{
      person?: { email?: string | null; email_status?: string | null; title?: string | null; linkedin_url?: string | null } | null;
    }>(`${this.baseUrl}/people/match`, {
      provider: "apollo",
      headers: { "x-api-key": this.apiKey, "cache-control": "no-cache" },
      body: {
        first_name: q.firstName,
        last_name: q.lastName ?? undefined,
        organization_name: q.companyName ?? undefined,
        domain: q.companyDomain ?? undefined,
        linkedin_url: q.linkedinUrl ?? undefined,
        reveal_personal_emails: false,
      },
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
    const p = res.person;
    const email = p?.email && !/email_not_unlocked/i.test(p.email) ? p.email.toLowerCase() : null;
    return {
      provider: "apollo",
      found: !!p,
      email,
      emailVerified: !!email && p?.email_status === "verified",
      emailStatusRaw: p?.email_status ?? null,
      title: p?.title ?? null,
      linkedinUrl: p?.linkedin_url ?? null,
      mock: false,
    };
  }
}

/** RocketReach person lookup (GET /api/v2/person/lookup). */
export class RocketReachProvider implements EnrichmentProvider {
  readonly name = "rocketreach" as const;
  readonly mock = false;
  private limiter = new RateLimiter(3, 0.5);
  constructor(
    private apiKey: string,
    private fetchImpl?: typeof fetch,
    private logger: Logger = silentLogger,
    private baseUrl = "https://api.rocketreach.co/api/v2",
  ) {}
  async enrichPerson(q: EnrichmentQuery): Promise<EnrichmentResult> {
    const params = new URLSearchParams();
    if (q.linkedinUrl) params.set("linkedin_url", q.linkedinUrl);
    else {
      params.set("name", [q.firstName, q.lastName].filter(Boolean).join(" "));
      if (q.companyName) params.set("current_employer", q.companyName);
    }
    const res = await httpJson<{
      status?: string;
      current_title?: string | null;
      linkedin_url?: string | null;
      emails?: { email: string; smtp_valid?: string; type?: string }[];
    }>(`${this.baseUrl}/person/lookup?${params}`, {
      provider: "rocketreach",
      headers: { "Api-Key": this.apiKey },
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
    const work = (res.emails ?? []).filter((e) => e.type !== "personal");
    const best = work.find((e) => e.smtp_valid === "valid") ?? work[0];
    return {
      provider: "rocketreach",
      found: !!res.status,
      email: best?.email?.toLowerCase() ?? null,
      emailVerified: best?.smtp_valid === "valid",
      emailStatusRaw: best?.smtp_valid ?? res.status ?? null,
      title: res.current_title ?? null,
      linkedinUrl: res.linkedin_url ?? null,
      mock: false,
    };
  }
}

/** Mock never fabricates contact details: it always reports "not found". */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = "mock" as const;
  readonly mock = true;
  async enrichPerson(): Promise<EnrichmentResult> {
    return { provider: "mock", found: false, email: null, emailVerified: false, emailStatusRaw: "mock_not_configured", title: null, linkedinUrl: null, mock: true };
  }
}

export function createEnrichmentProvider(env: Env, preferred?: "apollo" | "rocketreach", opts: { fetchImpl?: typeof fetch; logger?: Logger } = {}): EnrichmentProvider {
  const order = preferred === "rocketreach" ? ["rocketreach", "apollo"] : ["apollo", "rocketreach"];
  for (const p of order) {
    if (p === "apollo" && env.APOLLO_API_KEY) return new ApolloProvider(env.APOLLO_API_KEY, opts.fetchImpl, opts.logger);
    if (p === "rocketreach" && env.ROCKETREACH_API_KEY) return new RocketReachProvider(env.ROCKETREACH_API_KEY, opts.fetchImpl, opts.logger);
  }
  return new MockEnrichmentProvider();
}
