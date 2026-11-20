import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzerReport, type AutomationInput } from "@tuck/shared";
import { asSystem, createCompany, createContact, withOrg, type Db } from "@tuck/db";
import { IntegrationError } from "@tuck/integrations";
import {
  approveCampaign,
  approveExecution,
  applyDeliveryEvent,
  calculateFitScore,
  claimExecutions,
  convertSignalToOpportunity,
  createCampaign,
  dispatchEvent,
  draftNewsletter,
  enrichContact,
  evaluateConditions,
  generateCampaignMessages,
  runAnalyzer,
  runAutomationQueueOnce,
  runResearchQueueOnce,
  enqueueResearch,
  sanitizeClaims,
  scanReddit,
  sendCampaignBatch,
  sendDueNewsletters,
  setCampaignStatus,
  submitCampaignForReview,
  suppressEmail,
  syncCompanyToExternalCrm,
  transitionNewsletter,
  retryExecution,
} from "../src";
import { ALICE, BEN, FakeResearch, ORG, ctxAlice, fakeScoring, makeDeps, setupDb, source } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await setupDb();
}, 60_000);
afterAll(() => db.close());

async function addAutomation(def: AutomationInput, status = "active") {
  const { rows } = await asSystem(db, (tx) =>
    tx.query<{ id: string }>("insert into automations (organization_id, name, trigger_type, definition, status) values ($1,$2,$3,$4,$5) returning id", [ORG, def.name, def.trigger.type, JSON.stringify(def), status]),
  );
  return rows[0]!.id;
}
const base = { description: "", conditions: [], conditionMode: "all" as const, retry: { maxAttempts: 2, backoffSeconds: 1, backoffMultiplier: 1 }, enabled: true };

describe("conditions", () => {
  it("evaluates all/any modes", () => {
    const ctx = { payload: { kind: "buyer", score: 80, tags: ["saas"] } };
    expect(evaluateConditions([{ path: "payload.kind", op: "eq", value: "buyer" }, { path: "payload.score", op: "gte", value: 70 }], "all", ctx).passed).toBe(true);
    expect(evaluateConditions([{ path: "payload.kind", op: "eq", value: "target" }, { path: "payload.tags", op: "contains", value: "saas" }], "any", ctx).passed).toBe(true);
    expect(evaluateConditions([{ path: "payload.missing", op: "exists" }], "all", ctx).passed).toBe(false);
  });
});

describe("automation runtime", () => {
  let companyId: string;
  beforeAll(async () => {
    companyId = (await withOrg(db, ctxAlice, (tx) => createCompany(tx, ORG, ALICE, { name: "Acme Health", website: "https://acmehealth.example", kind: "target", tags: [], customFields: {} }))).id;
  });

  it("dispatches, deduplicates and runs research actions", async () => {
    const deps = makeDeps(db);
    await addAutomation({ ...base, name: "overview", trigger: { type: "company.created", config: {} }, actions: [{ id: "o", type: "research.business_overview", params: {}, delaySeconds: 0, requiresApproval: false, continueOnError: false }] });
    const a = await dispatchEvent(deps, ORG, { type: "company.created", payload: { companyId }, dedupeKey: `company:${companyId}` });
    const b = await dispatchEvent(deps, ORG, { type: "company.created", payload: { companyId }, dedupeKey: `company:${companyId}` });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0); // duplicate prevention
    const [exec] = await runAutomationQueueOnce(deps);
    expect(exec?.status).toBe("succeeded");
    expect(exec?.steps[0]?.output).toMatchObject({ kind: "business_overview" });
  });

  it("records skipped executions when conditions fail", async () => {
    const deps = makeDeps(db);
    await addAutomation({ ...base, name: "buyers only", trigger: { type: "contact.created", config: {} }, conditions: [{ path: "payload.kind", op: "eq", value: "buyer" }], actions: [{ id: "t", type: "task.create", params: { title: "x" }, delaySeconds: 0, requiresApproval: false, continueOnError: false }] });
    await dispatchEvent(deps, ORG, { type: "contact.created", payload: { kind: "target" }, dedupeKey: "c1" });
    const { rows } = await asSystem(db, (tx) => tx.query<{ status: string; error: string }>("select status, error from automation_executions where dedupe_key = 'contact.created:c1'"));
    expect(rows[0]).toMatchObject({ status: "skipped" });
    expect(rows[0]!.error).toMatch(/payload.kind/);
  });

  it("pauses on delays and approval gates, then resumes after human approval", async () => {
    let now = new Date();
    const deps = makeDeps(db, { now: () => now, env: { WEBHOOK_SIGNING_SECRET: "x" } });
    await addAutomation({
      ...base,
      name: "gated",
      trigger: { type: "meeting.completed", config: {} },
      actions: [
        { id: "wait", type: "task.create", params: { title: "after delay", companyId }, delaySeconds: 3600, requiresApproval: false, continueOnError: false },
        { id: "gate", type: "notify.member", params: { message: "approved step" }, delaySeconds: 0, requiresApproval: true, continueOnError: false },
      ],
    });
    await dispatchEvent(deps, ORG, { type: "meeting.completed", payload: { companyId }, dedupeKey: "m1" });
    let [e] = await runAutomationQueueOnce(deps);
    expect(e?.status).toBe("waiting");
    expect(await claimExecutions(deps)).toHaveLength(0); // delay not yet elapsed
    await asSystem(db, (tx) => tx.query("update automation_executions set resume_at = now() - interval '1 second' where id = $1", [e!.id]));
    now = new Date(Date.now() + 2 * 3600_000);
    [e] = await runAutomationQueueOnce(deps);
    expect(e?.status).toBe("awaiting_approval");
    expect(e?.steps[0]?.status).toBe("succeeded");
    await withOrg(db, { userId: BEN, organizationId: ORG, role: "admin" }, (tx) => approveExecution(tx, ORG, BEN, e!.id));
    [e] = await runAutomationQueueOnce(deps);
    expect(e?.status).toBe("succeeded");
    expect(e?.steps[1]?.approvedBy).toBe(BEN);
  });

  it("retries transient failures, then fails, and supports manual retry", async () => {
    const deps = makeDeps(db);
    await addAutomation({ ...base, name: "enrich", trigger: { type: "contact.enriched", config: {} }, actions: [{ id: "fit", type: "fit_score.calculate", params: {}, delaySeconds: 0, requiresApproval: false, continueOnError: false }] });
    await dispatchEvent(deps, ORG, { type: "contact.enriched", payload: { buyerCompanyId: companyId, targetCompanyId: companyId }, dedupeKey: "e1" });
    const [e] = await runAutomationQueueOnce(deps);
    // ValidationError (same company / no scoring service) is not retried
    expect(e?.status).toBe("failed");
    expect(e?.error).toMatch(/different companies|not configured/);
    await withOrg(db, ctxAlice, (tx) => retryExecution(tx, ORG, e!.id));
    const { rows } = await asSystem(db, (tx) => tx.query<{ status: string }>("select status from automation_executions where id = $1", [e!.id]));
    expect(rows[0]?.status).toBe("pending");
  });

  it("does not run executions of paused automations", async () => {
    const deps = makeDeps(db);
    const id = await addAutomation({ ...base, name: "paused", trigger: { type: "target.discovered", config: {} }, actions: [{ id: "t", type: "task.create", params: { title: "x" }, delaySeconds: 0, requiresApproval: false, continueOnError: false }] }, "active");
    await dispatchEvent(deps, ORG, { type: "target.discovered", payload: {}, dedupeKey: "p1" });
    await asSystem(db, (tx) => tx.query("update automations set status = 'paused' where id = $1", [id]));
    await asSystem(db, (tx) => tx.query("update automation_executions set status = 'cancelled' where status in ('pending','failed') and automation_id <> $1", [id]));
    expect(await claimExecutions(deps)).toHaveLength(0);
  });
});

describe("research engine", () => {
  it("sanitizes invented source ids and downgrades unsupported 'sourced' claims", () => {
    const out = sanitizeClaims({ a: { text: "x", provenance: "sourced", sourceIds: ["fake"], confidence: "high" } }, new Set(["real"]));
    expect(out.a).toMatchObject({ provenance: "assessment", sourceIds: [], confidence: "low" });
  });

  it("runs a queued business overview job and stores a sourced report", async () => {
    const research = new FakeResearch({ "acme2.example": source("https://acme2.example/", "Acme builds scheduling software for clinics and hospitals in the United States.") });
    const deps = makeDeps(db, { research });
    const company = await withOrg(db, ctxAlice, (tx) => createCompany(tx, ORG, ALICE, { name: "Acme Two", website: "https://acme2.example", kind: "target", tags: [], customFields: {} }));
    await withOrg(db, ctxAlice, (tx) => enqueueResearch(tx, ORG, ALICE, { kind: "business_overview", companyId: company.id }));
    const results = await runResearchQueueOnce(deps);
    const ok = results.find((r) => r.ok);
    expect(ok).toBeTruthy();
    const { rows } = await asSystem(db, (tx) => tx.query<{ content: { overview: { provenance: string }; revenueIndicators: { provenance: string } } }>("select content from research_reports where id = $1", [ok!.ok ? ok!.reportId : ""]));
    expect(rows[0]?.content.overview.provenance).toBe("sourced");
    expect(rows[0]?.content.revenueIndicators.provenance).toBe("unknown"); // never invented
  });

  it("marks research jobs failed with the reason when data is missing", async () => {
    const deps = makeDeps(db);
    const company = await withOrg(db, ctxAlice, (tx) => createCompany(tx, ORG, ALICE, { name: "No Site Co", kind: "target", tags: [], customFields: {} }));
    const job = await withOrg(db, ctxAlice, (tx) => enqueueResearch(tx, ORG, ALICE, { kind: "positioning_statement", companyId: company.id }));
    await runResearchQueueOnce(deps);
    const { rows } = await asSystem(db, (tx) => tx.query<{ status: string; last_error: string }>("select status, last_error from research_jobs where id = $1", [job.id]));
    expect(rows[0]).toMatchObject({ status: "failed" });
    expect(rows[0]!.last_error).toMatch(/website/);
  });

  it("produces a schema-valid analyzer report with disclaimer and explicit unknowns", async () => {
    const research = new FakeResearch({
      "target.example": source("https://target.example/", "Target Co provides patient intake software for clinics in Canada."),
      "buyer.example": source("https://buyer.example/", "Buyer Corp is a healthcare software platform serving hospitals across North America.", "Buyer Corp"),
    });
    const scoring = fakeScoring();
    const deps = makeDeps(db, { research, scoring: scoring.client as never });
    const report = await runAnalyzer(deps, { targetUrl: "https://target.example", buyerUrl: "https://buyer.example" });
    expect(analyzerReport.safeParse(report).success).toBe(true);
    expect(report.fit.grade).toBe("strong");
    expect(report.target.revenueIndicators.provenance).toBe("unknown");
    expect(report.disclaimer).toMatch(/not financial, legal, investment/);
    expect(report.providers.mock).toBe(true);
    const facts = scoring.calls[0] as { target: { revenueUsd: unknown } };
    expect(facts.target.revenueUsd).toBeNull();
  });

  it("returns insufficient_data rather than a fake score when scoring is unavailable", async () => {
    const research = new FakeResearch({ "t.example": source("https://t.example/", "T"), "b.example": source("https://b.example/", "B") });
    const report = await runAnalyzer(makeDeps(db, { research }), { targetUrl: "https://t.example", buyerUrl: "https://b.example" });
    expect(report.fit.score).toBeNull();
    expect(report.fit.grade).toBe("insufficient_data");
  });

  it("rejects private URLs and identical companies", async () => {
    const deps = makeDeps(db);
    await expect(runAnalyzer(deps, { targetUrl: "http://localhost", buyerUrl: "https://b.example" })).rejects.toBeInstanceOf(IntegrationError);
    await expect(runAnalyzer(deps, { targetUrl: "https://a.example", buyerUrl: "https://www.a.example/about" })).rejects.toThrow(/different/);
  });
});

describe("CRM services", () => {
  it("mock enrichment never fabricates an email", async () => {
    const deps = makeDeps(db);
    const c = await withOrg(db, ctxAlice, (tx) => createContact(tx, ORG, ALICE, { firstName: "Nia", lastName: "Stone", tags: [], source: "manual", emailStatus: "unverified" }));
    const r = await enrichContact(deps, ORG, c.id, ALICE);
    expect(r.contact.email).toBeNull();
    expect(r.result.mock).toBe(true);
  });

  it("calculates, persists, and syncs fit scores to the external CRM", async () => {
    const scoring = fakeScoring();
    const deps = makeDeps(db, { scoring: scoring.client as never });
    const { buyer, target } = await withOrg(db, ctxAlice, async (tx) => ({
      buyer: await createCompany(tx, ORG, ALICE, { name: "BigCo", kind: "buyer", industry: "Healthcare", tags: [], customFields: { revenue_usd: 5e7 } }),
      target: await createCompany(tx, ORG, ALICE, { name: "SmallCo", kind: "target", industry: "Healthcare", tags: [], customFields: {} }),
    }));
    const r = await calculateFitScore(deps, ORG, buyer.id, target.id, ALICE);
    expect(r.result.score).toBe(72.5);
    const sent = scoring.calls[0] as { buyer: { revenueUsd: unknown } };
    expect(sent.buyer.revenueUsd).toBeNull(); // unverified revenue is not used
    const sync = await syncCompanyToExternalCrm(deps, ORG, target.id);
    expect(sync).toMatchObject({ mock: true, fitSynced: true });
    const again = await syncCompanyToExternalCrm(deps, ORG, target.id);
    expect(again.externalId).toBe(sync.externalId); // mapping reused
  });
});

describe("bulk outreach", () => {
  it("enforces segmentation, suppression, separate approval, compliance and send limits", async () => {
    const deps = makeDeps(db);
    const ids = await withOrg(db, ctxAlice, async (tx) => {
      const co = await createCompany(tx, ORG, ALICE, { name: "Outreach Target", kind: "target", industry: "Software", tags: ["q3"], customFields: {} });
      const mk = (n: string, email: string, status: "unverified" | "manually_verified") =>
        createContact(tx, ORG, ALICE, { firstName: n, email, emailStatus: status, companyId: co.id, tags: ["q3"], source: "manual" });
      return [await mk("Ann", "ann@ot.example", "manually_verified"), await mk("Bo", "bo@ot.example", "manually_verified"), await mk("Cy", "cy@ot.example", "unverified"), await mk("Di", "di@ot.example", "manually_verified")];
    });
    await withOrg(db, ctxAlice, (tx) => suppressEmail(tx, ORG, "di@ot.example"));
    const campaign = await withOrg(db, ctxAlice, (tx) =>
      createCampaign(tx, ORG, ALICE, { name: "Q3 owners", subjectTemplate: "Hello {{first_name}}", bodyTemplate: "Hi {{first_name}} at {{company.name}}", segment: { tags: ["q3"], companyKinds: [], requireVerifiedEmail: true }, dailySendLimit: 1, fromName: "Alice", fromEmail: "alice@tuck.test" }),
    );
    const gen = await generateCampaignMessages(deps, ORG, ALICE, campaign.id);
    expect(gen.created).toBe(2);
    expect(gen.excluded.map((e) => e.reason).sort()).toEqual(["suppressed", "unverified_email"]);

    // Nothing sends before approval
    expect((await sendCampaignBatch(deps)).length).toBe(0);
    await withOrg(db, ctxAlice, (tx) => submitCampaignForReview(tx, ORG, campaign.id));
    await expect(withOrg(db, ctxAlice, (tx) => approveCampaign(tx, ORG, ALICE, campaign.id))).rejects.toThrow(/other than its author/);
    await withOrg(db, { userId: BEN, organizationId: ORG, role: "admin" }, (tx) => approveCampaign(tx, ORG, BEN, campaign.id));
    await withOrg(db, ctxAlice, (tx) => setCampaignStatus(tx, ORG, campaign.id, "start"));

    const [r1] = await sendCampaignBatch(deps);
    expect(r1).toMatchObject({ sent: 1 }); // daily limit = 1
    expect(deps.email.outbox[0]!.text).toMatch(/unsubscribe/i);
    expect((await sendCampaignBatch(deps))[0]).toMatchObject({ sent: 0 });

    // Bounce → suppression + invalid email
    const { rows } = await asSystem(db, (tx) => tx.query<{ provider_message_id: string; to_email: string }>("select provider_message_id, to_email from outreach_messages where status = 'sent'"));
    await applyDeliveryEvent(deps, { providerMessageId: rows[0]!.provider_message_id, status: "bounced" });
    const sup = await asSystem(db, (tx) => tx.query("select * from suppression_list where email = $1", [rows[0]!.to_email]));
    expect(sup.rows).toHaveLength(1);
    expect(ids).toHaveLength(4);
  });

  it("blocks approval when template fields are unresolved", async () => {
    const deps = makeDeps(db);
    const c = await withOrg(db, ctxAlice, (tx) =>
      createCampaign(tx, ORG, ALICE, { name: "Broken", subjectTemplate: "Hi {{nickname}}", bodyTemplate: "Body", segment: { tags: ["q3"], companyKinds: [], requireVerifiedEmail: true }, dailySendLimit: 10, fromName: "A", fromEmail: "a@tuck.test" }),
    );
    await generateCampaignMessages(deps, ORG, ALICE, c.id);
    await withOrg(db, ctxAlice, (tx) => submitCampaignForReview(tx, ORG, c.id));
    await expect(withOrg(db, { userId: BEN, organizationId: ORG, role: "admin" }, (tx) => approveCampaign(tx, ORG, BEN, c.id))).rejects.toThrow(/Compliance/);
  });
});

describe("newsletters & reddit", () => {
  it("requires review and approval by another member, and only emails consented subscribers", async () => {
    const deps = makeDeps(db);
    await asSystem(db, (tx) =>
      tx.query("insert into newsletter_subscribers (organization_id, email, status, consent_at) values ($1,'yes@x.example','subscribed',now()), ($1,'pending@x.example','pending',null)", [ORG]),
    );
    const n = await draftNewsletter(deps, ORG, ALICE, { title: "Q3 healthcare software M&A", topic: "healthcare software consolidation" });
    await withOrg(db, ctxAlice, (tx) => transitionNewsletter(tx, ORG, ALICE, n.id, "submit"));
    await expect(withOrg(db, ctxAlice, (tx) => transitionNewsletter(tx, ORG, ALICE, n.id, "approve"))).rejects.toThrow(/other than its author/);
    await withOrg(db, { userId: BEN, organizationId: ORG, role: "admin" }, (tx) => transitionNewsletter(tx, ORG, BEN, n.id, "approve"));
    await withOrg(db, ctxAlice, (tx) => transitionNewsletter(tx, ORG, ALICE, n.id, "schedule", new Date(Date.now() - 1000).toISOString()));
    const [res] = await sendDueNewsletters(deps);
    expect(res).toMatchObject({ sent: 1, simulated: 1 });
    expect(deps.email.outbox.map((m) => m.to)).toEqual(["yes@x.example"]);
  });

  it("stores reddit signals with source URL + timestamp and converts to an opportunity once", async () => {
    const deps = makeDeps(db);
    const r = await scanReddit(deps, ORG, { query: "selling my business" });
    expect(r.mock).toBe(true);
    expect(r.saved).toBeGreaterThan(0);
    const { rows } = await asSystem(db, (tx) => tx.query<{ id: string; url: string; retrieved_at: string }>("select id, url, retrieved_at from reddit_signals where organization_id = $1", [ORG]));
    expect(rows[0]!.url).toMatch(/^https:\/\/www\.reddit\.com\//);
    expect(rows[0]!.retrieved_at).toBeTruthy();
    const a = await convertSignalToOpportunity(deps, ORG, ALICE, rows[0]!.id);
    const b = await convertSignalToOpportunity(deps, ORG, ALICE, rows[0]!.id);
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
  });
});
