import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGmailThread } from "../src/content/gmail";
import { parseLinkedinCompany } from "../src/content/linkedin-company";
import { parseLinkedinPerson } from "../src/content/linkedin-person";

const fx = (name: string) => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
};

describe("LinkedIn company parser", () => {
  it("extracts visible top-card and about fields", () => {
    const ctx = parseLinkedinCompany(fx("linkedin-company.html"), "https://www.linkedin.com/company/northwind-analytics/about/");
    expect(ctx).toEqual({
      kind: "linkedin_company",
      url: "https://www.linkedin.com/company/northwind-analytics/",
      slug: "northwind-analytics",
      name: "Northwind Analytics",
      tagline: "Operational analytics for regional logistics fleets",
      industry: "Software Development",
      headquarters: "Columbus, Ohio",
      website: "https://www.northwind-analytics.example",
      employeeRange: "51-200",
    });
  });
  it("falls back to top-card info items when the About tab is not open", () => {
    const doc = new DOMParser().parseFromString(
      `<main><h1>Fallback Co</h1><div class="org-top-card-summary-info-list__info-item">IT Services</div>
       <div class="org-top-card-summary-info-list__info-item">Austin, Texas</div>
       <div class="org-top-card-summary-info-list__info-item">11-50 employees</div></main>`,
      "text/html",
    );
    expect(parseLinkedinCompany(doc, "https://www.linkedin.com/company/fallback-co/")).toMatchObject({
      name: "Fallback Co",
      industry: "IT Services",
      headquarters: "Austin, Texas",
      employeeRange: "11-50",
    });
  });
  it("rejects non-company URLs and ignores javascript: website links", () => {
    expect(parseLinkedinCompany(fx("linkedin-company.html"), "https://www.linkedin.com/in/someone/")).toBeNull();
    const doc = new DOMParser().parseFromString(`<h1>X</h1><dl><dt>Website</dt><dd><a href="javascript:alert(1)">click</a></dd></dl>`, "text/html");
    expect(parseLinkedinCompany(doc, "https://www.linkedin.com/company/x/")).not.toHaveProperty("website");
  });
});

describe("LinkedIn person parser", () => {
  it("extracts name, headline, location and current company", () => {
    const ctx = parseLinkedinPerson(fx("linkedin-person.html"), "https://www.linkedin.com/in/sample-person-123/");
    expect(ctx).toEqual({
      kind: "linkedin_person",
      url: "https://www.linkedin.com/in/sample-person-123/",
      slug: "sample-person-123",
      name: "Jordan Sample",
      headline: "Chief Operating Officer at Northwind Analytics",
      location: "Columbus, Ohio, United States",
      currentCompany: "Northwind Analytics",
    });
  });
  it("derives company from headline when the company button is absent", () => {
    const doc = new DOMParser().parseFromString(`<main><h1>Alex Example</h1><div class="text-body-medium break-words">Founder at Example Labs</div></main>`, "text/html");
    expect(parseLinkedinPerson(doc, "https://www.linkedin.com/in/alex/")).toMatchObject({ currentCompany: "Example Labs" });
  });
});

describe("Gmail parser", () => {
  const url = "https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmTzLpQrStUv";
  it("reads only the open thread's subject and participant addresses", () => {
    const ctx = parseGmailThread(fx("gmail-thread.html"), url);
    expect(ctx?.kind).toBe("gmail_thread");
    if (ctx?.kind !== "gmail_thread") return;
    expect(ctx.subject).toBe("Intro: Northwind Analytics x Harbor Capital");
    expect(ctx.threadId).toBe("thread-f:1790000000000000001");
    expect(ctx.participants).toEqual([
      { email: "jordan@northwind-analytics.example", name: "Jordan Sample" },
      { email: "analyst@example.test", name: "Test Analyst" },
      { email: "partner@harbor-capital.example", name: "Pat Partner" },
    ]);
  });
  it("dedupes participants, drops invalid addresses and ignores the inbox list", () => {
    const ctx = parseGmailThread(fx("gmail-thread.html"), url);
    if (ctx?.kind !== "gmail_thread") throw new Error("expected thread");
    const emails = ctx.participants.map((p) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).not.toContain("not-an-email");
    expect(emails).not.toContain("other-thread@unrelated.example");
  });
  it("never captures message bodies", () => {
    const ctx = parseGmailThread(fx("gmail-thread.html"), url);
    expect(JSON.stringify(ctx)).not.toContain("confidential revenue");
  });
  it("returns null when no conversation is open", () => {
    const doc = new DOMParser().parseFromString(`<div role="main"><table><tr><td><span email="x@y.example">X</span></td></tr></table></div>`, "text/html");
    expect(parseGmailThread(doc, "https://mail.google.com/mail/u/0/#inbox")).toBeNull();
  });
});
