import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, AuthError } from "../src/lib/errors";
import { h, safeHref } from "../src/sidepanel/dom";
import {
  contactCard,
  fitScoreCard,
  renderGmail,
  renderLinkedinCompany,
  renderLinkedinPerson,
  renderLogin,
  renderValue,
  runResearch,
  type PanelDeps,
} from "../src/sidepanel/views";
import { USER } from "./helpers";

const XSS = `<img src=x onerror="window.__pwned=1">`;

function deps(routes: Record<string, (body?: unknown) => unknown>, extra: Partial<PanelDeps> = {}): PanelDeps & { calls: { method: string; path: string; body?: unknown }[] } {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const run = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    if (!key) throw new Error(`unexpected ${method} ${path}`);
    return routes[key]!(body);
  };
  return {
    calls,
    baseUrl: "https://app.tuck.test",
    user: USER,
    api: { get: (p) => run("GET", p) as never, post: (p, b) => run("POST", p, b) as never },
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    refreshContext: vi.fn(async () => undefined),
    onAuthLost: vi.fn(),
    pollIntervalMs: 1,
    ...extra,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("main");
  document.body.append(root);
  (window as unknown as { __pwned?: number }).__pwned = undefined;
});

describe("XSS safety", () => {
  it("renders hostile page and API data as inert text", async () => {
    const d = deps({ "GET /api/v1/match": () => ({ companies: [{ id: "c1", name: XSS, domain: XSS, industry: XSS, kind: "target" }], contacts: [], deals: [{ id: "d1", name: XSS, stage: XSS, target_company_id: "c1", buyer_company_id: null }] }) });
    await renderLinkedinCompany(root, { kind: "linkedin_company", url: "https://www.linkedin.com/company/x/", slug: "x", name: XSS }, d);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain(XSS);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("neutralises javascript: links", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(h("a", { href: "javascript:alert(1)" }).getAttribute("href")).toBe("#");
    expect(safeHref("https://ok.example/x")).toBe("https://ok.example/x");
  });

  it("escapes structured report content", () => {
    const node = renderValue({ overview: { text: XSS, provenance: "assessment" }, list: [XSS] });
    const wrap = document.createElement("div");
    wrap.append(node);
    expect(wrap.querySelector("img")).toBeNull();
    expect(wrap.textContent).toContain("AI assessment");
  });
});

describe("LinkedIn company view", () => {
  const ctx = { kind: "linkedin_company" as const, url: "https://www.linkedin.com/company/northwind/", slug: "northwind", name: "Northwind Analytics", website: "northwind.example", industry: "Software" };

  it("shows the existing CRM record with color-coded deals", async () => {
    const d = deps({
      "GET /api/v1/match": () => ({
        companies: [{ id: "c1", name: "Northwind Analytics", domain: "northwind.example", industry: "Software", kind: "target" }],
        contacts: [],
        deals: [{ id: "d1", name: "Project North", stage: "diligence", target_company_id: "c1", buyer_company_id: null }],
      }),
    });
    await renderLinkedinCompany(root, ctx, d);
    expect(d.calls[0]!.path).toContain("domain=northwind.example");
    expect(root.querySelector(".chip.stage-diligence")?.textContent).toBe("Diligence");
    expect(root.textContent).toContain("already in your CRM");
  });

  it("creates a company from the reviewed form and only researches when opted in", async () => {
    const d = deps({
      "GET /api/v1/match": () => ({ companies: [], contacts: [], deals: [] }),
      "POST /api/v1/companies": (b) => ({ id: "new1", name: (b as { name: string }).name, domain: "northwind.example", industry: "Software", kind: "prospect" }),
      "POST /api/v1/research": () => ({ id: "j1", status: "succeeded", report: null }),
    });
    await renderLinkedinCompany(root, ctx, d);
    const form = root.querySelector("form")!;
    (form.querySelector("input[name=name]") as HTMLInputElement).value = "Northwind Analytics (edited)";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    await tick();
    const post = d.calls.find((c) => c.path === "/api/v1/companies")!;
    expect(post.body).toMatchObject({ name: "Northwind Analytics (edited)", website: "https://northwind.example", linkedinUrl: ctx.url });
    expect(d.calls.some((c) => c.path === "/api/v1/research")).toBe(false);
    expect(root.textContent).toContain("Company created.");
  });

  it("shows duplicate warnings on 409", async () => {
    const d = deps({
      "GET /api/v1/match": () => ({ companies: [], contacts: [], deals: [] }),
      "POST /api/v1/companies": () => {
        throw new ApiError("exists", 409, { duplicates: [{ id: "c9", name: "Northwind Analytics LLC", domain: "northwind.example", reason: "domain" }] });
      },
    });
    await renderLinkedinCompany(root, ctx, d);
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    await tick();
    expect(root.querySelector(".notice-warn")?.textContent).toContain("Northwind Analytics LLC");
    expect(root.querySelector(".notice-warn a")?.getAttribute("href")).toBe("https://app.tuck.test/app/companies/c9");
  });

  it("returns to login when the session is lost", async () => {
    const d = deps({ "GET /api/v1/match": () => { throw new AuthError(); } });
    await renderLinkedinCompany(root, ctx, d);
    expect(d.onAuthLost).toHaveBeenCalled();
    expect(root.querySelector(".status-error")).not.toBeNull();
  });
});

describe("LinkedIn person view", () => {
  it("offers contact creation with company association and an outreach notice", async () => {
    const d = deps({
      "GET /api/v1/match?linkedinUrl": () => ({ companies: [], contacts: [], deals: [] }),
      "GET /api/v1/match?name": () => ({ companies: [{ id: "c1", name: "Northwind Analytics", domain: "northwind.example", industry: null, kind: "target" }], contacts: [], deals: [] }),
      "POST /api/v1/contacts": (b) => ({ id: "p1", first_name: "Jordan", last_name: "Sample", email: null, email_status: "unverified", title: (b as { title: string }).title, company_id: "c1", company_name: "Northwind Analytics" }),
    });
    await renderLinkedinPerson(root, { kind: "linkedin_person", url: "https://www.linkedin.com/in/jordan/", slug: "jordan", name: "Jordan Sample", headline: "COO at Northwind Analytics", currentCompany: "Northwind Analytics" }, d);
    expect(root.textContent).toContain("never sends messages or invitations");
    expect((root.querySelector("select[name=companyId]") as HTMLSelectElement).value).toBe("c1");
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    await tick();
    expect(d.calls.find((c) => c.path === "/api/v1/contacts")!.body).toMatchObject({ firstName: "Jordan", lastName: "Sample", companyId: "c1", emailStatus: "unverified" });
  });

  it("never presents an unverified enriched email as verified", async () => {
    const d = deps({ "POST /api/v1/contacts/p1/enrich": () => ({ id: "p1", first_name: "J", last_name: null, email: "guess@x.example", email_status: "unverified", title: null, company_id: null }) });
    root.append(contactCard({ id: "p1", first_name: "J", last_name: null, email: null, email_status: "unverified", title: null, company_id: null }, [], d));
    const btn = [...root.querySelectorAll("button")].find((b) => b.textContent === "Enrich contact")!;
    btn.click();
    await tick();
    await tick();
    expect(root.textContent).toContain("guess@x.example");
    expect(root.querySelector(".badge-warn")?.textContent).toBe("Unverified");
    expect(root.textContent).not.toContain("Verified by provider");
  });
});

describe("Gmail view", () => {
  const ctx = {
    kind: "gmail_thread" as const,
    url: "https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmTzLpQrStUv",
    threadId: "FMfcgzQXJWDsKmTzLpQrStUv",
    subject: "Intro call",
    participants: [
      { email: "jordan@northwind.example", name: "Jordan Sample" },
      { email: USER.email, name: "Me" },
      { email: "new@harbor.example", name: "New Person" },
    ],
  };

  it("matches participants (excluding the user), shows stage chips and logs only subject + participants", async () => {
    const d = deps({
      "GET /api/v1/match": () => ({
        companies: [],
        contacts: [{ id: "p1", first_name: "Jordan", last_name: "Sample", email: "jordan@northwind.example", email_status: "provider_verified", title: null, company_id: "c1", company_name: "Northwind" }],
        deals: [{ id: "d1", name: "North", stage: "loi", target_company_id: "c1", buyer_company_id: null }],
      }),
      "POST /api/v1/activities": () => ({ id: "a1" }),
    });
    await renderGmail(root, ctx, d);
    expect(d.calls[0]!.path).toContain(encodeURIComponent("jordan@northwind.example,new@harbor.example"));
    expect(d.calls[0]!.path).not.toContain(encodeURIComponent(USER.email));
    expect(root.querySelector(".chip.stage-loi")).not.toBeNull();
    expect(root.textContent).toContain("Message bodies and other emails are never read or sent");
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Log this thread to CRM")!.click();
    await tick();
    await tick();
    const body = d.calls.find((c) => c.path === "/api/v1/activities")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ type: "email", subject: "Intro call", contactId: "p1", companyId: "c1", externalRef: "gmail:FMfcgzQXJWDsKmTzLpQrStUv" });
    expect(Object.keys(body)).not.toContain("body");
    expect(root.textContent).toContain("Thread logged");
  });

  it("reports already-logged threads", async () => {
    const d = deps({
      "GET /api/v1/match": () => ({ companies: [], contacts: [{ id: "p1", first_name: "J", last_name: null, email: "jordan@northwind.example", email_status: "unverified", title: null, company_id: null }], deals: [] }),
      "POST /api/v1/activities": () => null,
    });
    await renderGmail(root, ctx, d);
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Log this thread to CRM")!.click();
    await tick();
    await tick();
    expect(root.textContent).toContain("already logged");
  });
});

describe("research + fit score", () => {
  it("polls a job until it succeeds and shows sources", async () => {
    let polls = 0;
    const d = deps({
      "POST /api/v1/research": () => ({ id: "j1", status: "queued" }),
      "GET /api/v1/research/jobs/j1": () =>
        ++polls < 2
          ? { id: "j1", status: "running" }
          : { id: "j1", status: "succeeded", report: { id: "r1", title: "Business overview", content: { overview: { text: "Fleet analytics", provenance: "sourced", sourceIds: ["s1"] } }, sources: [{ id: "s1", url: "https://northwind.example/about", title: "About" }] } },
    });
    await runResearch(d, root, { kind: "business_overview", companyId: "c1" });
    expect(polls).toBe(2);
    expect(root.textContent).toContain("Fleet analytics");
    expect(root.textContent).toContain("Sourced");
    expect(root.querySelector(".sources a")?.getAttribute("href")).toBe("https://northwind.example/about");
  });

  it("renders failed jobs with their error", async () => {
    const d = deps({ "POST /api/v1/research": () => ({ id: "j2", status: "failed", last_error: "Exa not configured" }) });
    await runResearch(d, root, { kind: "capital_raise", companyId: "c1" });
    expect(root.querySelector(".status-error")?.textContent).toContain("Exa not configured");
  });

  it("renders fit score cells, missing data and explanations", () => {
    root.append(
      fitScoreCard({
        modelKey: "default",
        modelVersion: 2,
        score: 72.4,
        grade: "strong",
        confidence: 0.6,
        coverage: 0.8,
        cells: [
          { criterionKey: "industry", label: "Industry overlap", weight: 20, score: 0.9, contribution: 18, rationale: "Both software", evidence: [], missing: false },
          { criterionKey: "scale", label: "Scale", weight: 10, score: null, contribution: 0, rationale: "No verified revenue", evidence: [], missing: true },
        ],
        exclusions: [],
        explanation: ["Strong industry overlap"],
      }),
    );
    expect(root.textContent).toContain("72");
    expect(root.textContent).toContain("missing");
    expect(root.textContent).toContain("Strong industry overlap");
  });
});

describe("login view", () => {
  it("submits credentials and clears the password field", async () => {
    const d = deps({});
    renderLogin(root, { state: "expired", user: null, baseUrl: "http://localhost:3000" }, d);
    expect(root.textContent).toContain("session expired");
    (root.querySelector("input[name=email]") as HTMLInputElement).value = "a@b.test";
    (root.querySelector("input[name=password]") as HTMLInputElement).value = "secret";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick();
    expect(d.login).toHaveBeenCalledWith("http://localhost:3000", "a@b.test", "secret");
    expect((root.querySelector("input[name=password]") as HTMLInputElement).value).toBe("");
  });
});
