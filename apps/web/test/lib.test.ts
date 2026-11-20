import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { reportToText } from "@/lib/report-text";

describe("csv", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    const rows = parseCsv('﻿name,tags\r\n"Acme, Inc.","a;b"\r\n"Say ""hi""",\r\n');
    expect(rows).toEqual([{ name: "Acme, Inc.", tags: "a;b" }, { name: 'Say "hi"', tags: "" }]);
  });
  it("neutralises spreadsheet formula injection on export", () => {
    const csv = toCsv([{ name: "=HYPERLINK(\"http://evil\")", note: "+1", ok: "fine" }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'+1");
  });
});

describe("reportToText", () => {
  it("renders claims with provenance and sources", () => {
    const t = reportToText("Overview", { overview: { text: "Makes software", provenance: "sourced" }, risks: ["Key person"] }, [{ url: "https://a.example", title: "A" }]);
    expect(t).toContain("Overview: Makes software [sourced]");
    expect(t).toContain("- Key person");
    expect(t).toContain("1. A — https://a.example");
  });
});
