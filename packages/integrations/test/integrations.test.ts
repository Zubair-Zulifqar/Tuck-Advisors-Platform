import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApolloProvider,
  AuthenticationError,
  ExaProvider,
  IntegrationError,
  MockCrmAdapter,
  MockEnrichmentProvider,
  MockLlmProvider,
  OpenAIProvider,
  PipelineCrmAdapter,
  RateLimitError,
  RateLimiter,
  RocketReachProvider,
  ScoringClient,
  WebsiteFetcher,
  createEmailProvider,
  createLlmProvider,
  decryptSecret,
  encryptSecret,
  extractPage,
  extractRedditSignals,
  httpJson,
  integrationStatuses,
  isPrivateIp,
  mapResendEvent,
  parseAddressList,
  robotsAllows,
  signWebhook,
  verifySvix,
  verifyWebhook,
  withRetry,
} from "../src";
import { createHmac } from "node:crypto";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = { sleep: async () => {} };

describe("httpJson / retry", () => {
  it("retries 5xx then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ ok: 1 }));
    const r = await httpJson("https://x.test", { provider: "t", fetchImpl: f, retry: noSleep });
    expect(r).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry auth failures", async () => {
    const f = vi.fn().mockImplementation(async () => json({}, 401));
    await expect(httpJson("https://x.test", { provider: "t", fetchImpl: f, retry: noSleep })).rejects.toBeInstanceOf(AuthenticationError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("surfaces rate limits with Retry-After and retries", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "2" })).mockResolvedValueOnce(json({ ok: true }));
    await httpJson("https://x.test", { provider: "t", fetchImpl: f, retry: { sleep: async (ms) => void sleeps.push(ms) } });
    expect(sleeps).toEqual([2000]);
  });
  it("gives up after max attempts with a typed error", async () => {
    const f = vi.fn().mockImplementation(async () => json({}, 429, { "retry-after": "0" }));
    await expect(httpJson("https://x.test", { provider: "t", fetchImpl: f, retry: { ...noSleep, maxAttempts: 2 } })).rejects.toBeInstanceOf(RateLimitError);
  });
  it("maps network failures to retryable IntegrationError", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const err = await httpJson("https://x.test", { provider: "t", fetchImpl: f, retry: { ...noSleep, maxAttempts: 2 } }).catch((e) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("withRetry does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new IntegrationError("bad", "t", 400, false));
    await expect(withRetry(fn, noSleep)).rejects.toThrow("bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("RateLimiter", () => {
  it("enforces capacity and refills over time", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1, () => t);
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(true);
    expect(rl.tryTake()).toBe(false);
    t = 1000;
    expect(rl.tryTake()).toBe(true);
  });
});

describe("LLM providers", () => {
  const schema = z.object({ summary: z.string() });
  it("OpenAI repairs invalid JSON once", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ choices: [{ message: { content: '{"wrong":1}' } }] }))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: '{"summary":"ok"}' } }] }));
    const p = new OpenAIProvider("sk-test", "gpt-test", undefined, f);
    expect(await p.completeJson(schema, { system: "s", user: "u", task: "t" }, () => ({ summary: "x" }))).toEqual({ summary: "ok" });
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
  it("OpenAI fails loudly after repeated invalid output", async () => {
    const f = vi.fn().mockImplementation(async () => json({ choices: [{ message: { content: "not json" } }] }));
    const p = new OpenAIProvider("sk-test", "m", undefined, f);
    await expect(p.completeJson(schema, { system: "s", user: "u", task: "t" }, () => ({ summary: "x" }))).rejects.toThrow(/failed validation/);
  });
  it("mock provider validates its fallback output", async () => {
    await expect(new MockLlmProvider().completeJson(schema, { system: "", user: "", task: "t" }, () => ({ summary: 1 }) as never)).rejects.toThrow();
  });
  it("refuses to fall back to mock in production", () => {
    expect(() => createLlmProvider({ NODE_ENV: "production" })).toThrow(/OPENAI_API_KEY/);
    expect(createLlmProvider({}).mock).toBe(true);
  });
});

describe("Exa", () => {
  it("maps results into research sources", async () => {
    const f = vi.fn().mockImplementation(async () => json({ results: [{ url: "https://a.example/news", title: "News", text: "Raised a Series A", publishedDate: "2026-01-02" }] }));
    const exa = new ExaProvider("k", f);
    const [s] = await exa.search("acme funding");
    expect(s).toMatchObject({ url: "https://a.example/news", provider: "exa", excerpt: "Raised a Series A" });
    expect(s!.id).toMatch(/^src_/);
    expect(f.mock.calls[0]![1].headers["x-api-key"]).toBe("k");
  });
});

describe("Website fetcher", () => {
  const publicResolver = async () => [{ address: "93.184.216.34" }];
  it("extracts title, description and text; respects robots.txt", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("robots.txt")
        ? new Response("User-agent: *\nDisallow: /private", { status: 200 })
        : new Response("<html><head><title>Acme &amp; Co</title><meta name=\"description\" content=\"Payroll software for clinics\"></head><body><script>x()</script><h1>Hi</h1></body></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    const w = new WebsiteFetcher(f, 100_000, publicResolver);
    const s = await w.fetchOne("https://acme.example/");
    expect(s?.title).toBe("Acme & Co");
    expect(s?.excerpt).toContain("Payroll software for clinics");
    expect(s?.excerpt).not.toContain("x()");
    expect(await w.fetchOne("https://acme.example/private/x")).toBeNull();
  });
  it("blocks private addresses and DNS rebinding", async () => {
    const w = new WebsiteFetcher(vi.fn() as never, 1000, async () => [{ address: "10.0.0.5" }]);
    await expect(w.fetchOne("http://127.0.0.1/")).rejects.toThrow(/public/);
    await expect(w.fetchOne("https://evil.example/")).rejects.toThrow(/non-public/);
  });
  it("helpers", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(extractPage("<meta content=\"D\" name=\"description\">").description).toBe("D");
  });
});

describe("Enrichment", () => {
  it("Apollo marks verified only when provider says verified", async () => {
    const f = vi.fn().mockImplementation(async () => json({ person: { email: "Jo@Acme.com", email_status: "guessed", title: "CFO" } }));
    const r = await new ApolloProvider("k", f).enrichPerson({ firstName: "Jo", companyDomain: "acme.com" });
    expect(r).toMatchObject({ email: "jo@acme.com", emailVerified: false, title: "CFO" });
  });
  it("Apollo ignores locked emails", async () => {
    const f = vi.fn().mockImplementation(async () => json({ person: { email: "email_not_unlocked@domain.com", email_status: "verified" } }));
    expect((await new ApolloProvider("k", f).enrichPerson({ firstName: "A" })).email).toBeNull();
  });
  it("RocketReach prefers SMTP-valid work emails", async () => {
    const f = vi.fn().mockResolvedValue(
      json({ status: "complete", emails: [{ email: "p@gmail.com", type: "personal", smtp_valid: "valid" }, { email: "a@acme.com", smtp_valid: "invalid" }, { email: "b@acme.com", smtp_valid: "valid" }] }),
    );
    const r = await new RocketReachProvider("k", f).enrichPerson({ firstName: "B", lastName: "C", companyName: "Acme" });
    expect(r).toMatchObject({ email: "b@acme.com", emailVerified: true });
  });
  it("mock never fabricates an email", async () => {
    const r = await new MockEnrichmentProvider().enrichPerson();
    expect(r).toMatchObject({ found: false, email: null, emailVerified: false, mock: true });
  });
  it("auth failure propagates", async () => {
    const f = vi.fn().mockImplementation(async () => json({ error: "bad key" }, 403));
    await expect(new ApolloProvider("k", f).enrichPerson({ firstName: "A" })).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("Pipeline CRM", () => {
  it("creates companies and writes configured fit-score fields", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ id: 42 })).mockResolvedValueOnce(json({ id: 42 }));
    const crm = new PipelineCrmAdapter({ apiKey: "k", fitScoreFieldId: "custom_label_9" }, f);
    expect(await crm.upsertCompany({ name: "Acme" })).toEqual({ externalId: "42" });
    await crm.writeFitScore("42", { value: 81, grade: "strong", summary: "" });
    const [url, init] = f.mock.calls[1]!;
    expect(url).toContain("/companies/42.json?api_key=k");
    expect(JSON.parse(init.body)).toEqual({ company: { custom_fields: { custom_label_9: 81 } } });
  });
  it("refuses fit-score writes without a configured field", async () => {
    await expect(new PipelineCrmAdapter({ apiKey: "k" }, vi.fn()).writeFitScore("1", { value: 1, grade: "weak", summary: "" })).rejects.toThrow(/PIPELINE_CRM_FIT_SCORE_FIELD/);
  });
  it("mock adapter records writes", async () => {
    const m = new MockCrmAdapter();
    const { externalId } = await m.upsertCompany({ name: "X" });
    await m.writeFitScore(externalId, { value: 50, grade: "moderate", summary: "s" });
    expect(m.companies.get(externalId)?.fit).toMatchObject({ value: 50 });
  });
});

describe("Email + webhooks", () => {
  it("mock email reports simulated, never delivered", async () => {
    const p = createEmailProvider({});
    expect((await p.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" })).status).toBe("simulated");
    expect(() => createEmailProvider({ NODE_ENV: "production" })).toThrow();
  });
  it("maps Resend events", () => {
    expect(mapResendEvent({ type: "email.bounced", data: { email_id: "e1" } })).toEqual({ providerMessageId: "e1", status: "bounced" });
    expect(mapResendEvent({ type: "email.opened", data: { email_id: "e1" } })).toBeNull();
  });
  it("verifies Svix signatures", () => {
    const secret = "whsec_" + Buffer.from("supersecretkey").toString("base64");
    const ts = "1700000000";
    const sig = createHmac("sha256", Buffer.from("supersecretkey")).update(`msg_1.${ts}.{"a":1}`).digest("base64");
    const h = { id: "msg_1", timestamp: ts, signature: `v1,${sig}` };
    expect(verifySvix(secret, '{"a":1}', h, 300, 1700000010)).toBe(true);
    expect(verifySvix(secret, '{"a":2}', h, 300, 1700000010)).toBe(false);
    expect(verifySvix(secret, '{"a":1}', h, 300, 1700009999)).toBe(false);
  });
  it("signs and verifies Tuck webhooks with replay protection", () => {
    const h = signWebhook("s3cret", "{}", 1000);
    expect(verifyWebhook("s3cret", "{}", h, 300, 1100)).toBe(true);
    expect(verifyWebhook("wrong", "{}", h, 300, 1100)).toBe(false);
    expect(verifyWebhook("s3cret", "{}", h, 300, 5000)).toBe(false);
    expect(verifyWebhook("s3cret", "{}", null)).toBe(false);
  });
  it("encrypts integration secrets", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const env = encryptSecret("api-key-123", key);
    expect(env).not.toContain("api-key-123");
    expect(decryptSecret(env, key)).toBe("api-key-123");
    expect(() => decryptSecret(env.replace(/.$/, "A"), key)).toThrow();
  });
});

describe("Gmail helpers & Reddit signals", () => {
  it("parses address lists", () => {
    expect(parseAddressList('"Doe, Jane" <Jane@Acme.com>, bob@x.io')).toEqual([
      { name: "Doe, Jane", email: "jane@acme.com" },
      { name: undefined, email: "bob@x.io" },
    ]);
  });
  it("extracts explainable M&A signals", () => {
    const s = extractRedditSignals({ title: "Thinking about selling my business before I retire", excerpt: "What multiple of EBITDA?" });
    expect(s.types).toEqual(expect.arrayContaining(["seller_intent", "valuation_question"]));
    expect(s.score).toBeGreaterThan(0.4);
    expect(extractRedditSignals({ title: "Best pizza", excerpt: "" }).types).toEqual([]);
  });
});

describe("Scoring client & registry", () => {
  it("rejects malformed scoring responses", async () => {
    const f = vi.fn().mockImplementation(async () => json({ score: "high" }));
    await expect(new ScoringClient("http://scoring", undefined, f).score({} as never, {} as never, {} as never)).rejects.toThrow(/invalid result/);
  });
  it("reports missing env var names but never values", () => {
    const s = integrationStatuses({ OPENAI_API_KEY: "sk-secret" });
    expect(s.find((x) => x.provider === "openai")?.mode).toBe("live");
    expect(s.find((x) => x.provider === "apollo")).toMatchObject({ mode: "mock", missing: ["APOLLO_API_KEY"] });
    expect(JSON.stringify(s)).not.toContain("sk-secret");
  });
});
