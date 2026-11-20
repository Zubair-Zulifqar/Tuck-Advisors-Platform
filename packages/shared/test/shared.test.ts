import { describe, expect, it } from "vitest";
import {
  claim,
  companyInput,
  isPublicHttpUrl,
  normalizeCompanyName,
  normalizeDomain,
  renderTemplate,
  roleHas,
  automationInput,
  pageContext,
} from "../src";

describe("normalizeDomain", () => {
  it("strips scheme, www and path", () => {
    expect(normalizeDomain("https://www.Acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("acme.io")).toBe("acme.io");
  });
  it("returns undefined for junk", () => {
    expect(normalizeDomain("not a url")).toBeUndefined();
    expect(normalizeDomain("")).toBeUndefined();
  });
});

describe("normalizeCompanyName", () => {
  it("removes legal suffixes", () => {
    expect(normalizeCompanyName("Acme Holdings, Inc.")).toBe("acme");
    expect(normalizeCompanyName("ACME LLC")).toBe("acme");
  });
});

describe("isPublicHttpUrl (SSRF guard)", () => {
  it.each([
    ["https://example.com", true],
    ["http://localhost:3000", false],
    ["http://127.0.0.1", false],
    ["http://10.1.2.3/x", false],
    ["http://192.168.1.1", false],
    ["http://169.254.169.254/latest/meta-data", false],
    ["ftp://example.com", false],
    ["https://user:pw@example.com", false],
    ["http://[::1]/", false],
  ])("%s -> %s", (url, ok) => expect(isPublicHttpUrl(url)).toBe(ok));
});

describe("claim provenance", () => {
  it("rejects sourced claims without sources", () => {
    expect(claim.safeParse({ text: "x", provenance: "sourced", sourceIds: [] }).success).toBe(false);
    expect(claim.safeParse({ text: "x", provenance: "assessment" }).success).toBe(true);
  });
});

describe("roles", () => {
  it("restricts approvals to admins/owners", () => {
    expect(roleHas("analyst", "outreach:approve")).toBe(false);
    expect(roleHas("admin", "outreach:approve")).toBe(true);
    expect(roleHas("admin", "members:manage")).toBe(false);
    expect(roleHas("viewer", "crm:write")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("fills vars and reports missing ones", () => {
    const r = renderTemplate("Hi {{first_name}} at {{company.name}}", { first_name: "Ana" });
    expect(r.text).toBe("Hi Ana at {{company.name}}");
    expect(r.missing).toEqual(["company.name"]);
  });
});

describe("schemas", () => {
  it("validates company domains", () => {
    expect(companyInput.safeParse({ name: "A", domain: "acme.com" }).success).toBe(true);
    expect(companyInput.safeParse({ name: "A", domain: "https://acme.com" }).success).toBe(false);
  });
  it("validates automation definitions", () => {
    const ok = automationInput.safeParse({
      name: "Research new companies",
      trigger: { type: "company.created" },
      actions: [{ id: "overview", type: "research.business_overview" }],
    });
    expect(ok.success).toBe(true);
  });
  it("parses page context union", () => {
    expect(pageContext.parse({ kind: "unsupported", url: "chrome://x" }).kind).toBe("unsupported");
  });
});
