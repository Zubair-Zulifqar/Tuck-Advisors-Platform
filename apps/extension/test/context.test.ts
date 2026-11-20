import { describe, expect, it } from "vitest";
import { detectContext, gmailThreadIdFromUrl } from "../src/lib/context";
import { normalizeBaseUrl, originPattern } from "../src/lib/config";

describe("detectContext", () => {
  it("detects LinkedIn company pages and canonicalises the URL", () => {
    const c = detectContext("https://www.linkedin.com/company/northwind-analytics/about/?trk=x");
    expect(c).toMatchObject({ kind: "linkedin_company", slug: "northwind-analytics", url: "https://www.linkedin.com/company/northwind-analytics/" });
  });
  it("detects LinkedIn person pages", () => {
    expect(detectContext("https://www.linkedin.com/in/sample-person-123/")).toMatchObject({ kind: "linkedin_person", slug: "sample-person-123" });
  });
  it("ignores LinkedIn feed, search and look-alike hosts", () => {
    expect(detectContext("https://www.linkedin.com/feed/").kind).toBe("unsupported");
    expect(detectContext("https://www.linkedin.com.evil.test/company/x").kind).toBe("unsupported");
    expect(detectContext("http://www.linkedin.com/company/x").kind).toBe("unsupported");
  });
  it("detects an open Gmail thread but not the inbox list", () => {
    expect(detectContext("https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmTzLpQrStUv")).toMatchObject({
      kind: "gmail_thread",
      threadId: "FMfcgzQXJWDsKmTzLpQrStUv",
    });
    expect(detectContext("https://mail.google.com/mail/u/0/#inbox").kind).toBe("unsupported");
  });
  it("detects the Tuck CRM by configured origin and extracts entity ids", () => {
    const id = "6f1c2c1e-1111-4222-8333-444455556666";
    expect(detectContext(`https://app.tuck.test/app/companies/${id}`, "https://app.tuck.test")).toMatchObject({ kind: "tuck_crm", entity: "companies", entityId: id });
    expect(detectContext("https://app.tuck.test/app", "https://app.tuck.test")).toMatchObject({ kind: "tuck_crm" });
    expect(detectContext("https://other.test/app", "https://app.tuck.test").kind).toBe("unsupported");
  });
  it("handles garbage and browser URLs", () => {
    expect(detectContext(undefined).kind).toBe("unsupported");
    expect(detectContext("chrome://extensions").kind).toBe("unsupported");
    expect(detectContext("not a url").kind).toBe("unsupported");
  });
  it("parses Gmail ids in label views", () => {
    expect(gmailThreadIdFromUrl("https://mail.google.com/mail/u/1/#label/Deals/FMfcgzQXJWDsKmTzLpQrStUv")).toBe("FMfcgzQXJWDsKmTzLpQrStUv");
  });
});

describe("base URL handling", () => {
  it("requires HTTPS except for localhost", () => {
    expect(normalizeBaseUrl("https://app.tuck.test/app/x")).toBe("https://app.tuck.test");
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => normalizeBaseUrl("http://app.tuck.test")).toThrow(/HTTPS/);
    expect(() => normalizeBaseUrl("javascript:alert(1)")).toThrow();
  });
  it("builds a single-origin permission pattern", () => {
    expect(originPattern("http://localhost:3000")).toBe("http://localhost/*");
    expect(originPattern("https://app.tuck.test")).toBe("https://app.tuck.test/*");
  });
});
