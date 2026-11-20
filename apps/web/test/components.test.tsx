import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analyzer } from "@/components/site/analyzer";
import { LeadForm } from "@/components/site/lead-form";
import { ReportBody } from "@/components/app/report-body";
import { EmailStatus, StageBadge } from "@/components/ui";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status });

const claim = (text: string, provenance = "assessment", sourceIds: string[] = []) => ({ text, provenance, sourceIds, confidence: "low" });
const profile = (name: string) => ({
  name, url: `https://${name.toLowerCase()}.example`, overview: claim(`${name} overview`, "sourced", ["s1"]), industry: claim("Software"), businessModel: claim("SaaS"),
  productsAndServices: [], customerSegments: [], marketPositioning: claim("n/a", "unknown"), geography: claim("n/a", "unknown"), revenueIndicators: claim("No reliable revenue data", "unknown"), growthIndicators: [],
});
const report = {
  generatedAt: new Date().toISOString(), target: profile("Target"), buyer: profile("Buyer"),
  strategicFit: [claim("Good fit")], synergies: [], marketExpansion: [], acquisitionRationale: [], risks: [claim("<img src=x onerror=alert(1)>")], considerations: [],
  fit: { modelKey: "m", modelVersion: 1, score: 64, grade: "moderate", confidence: 0.7, coverage: 0.8, cells: [{ criterionKey: "industry", label: "Industry overlap", weight: 20, score: 0.8, contribution: 16, rationale: "Same sector", evidence: [], missing: false }], exclusions: [], explanation: ["Overall fit 64/100"] },
  sources: [{ id: "s1", url: "https://target.example/", title: "Target home", provider: "website", retrievedAt: new Date().toISOString(), excerpt: "" }],
  providers: { research: "website", llm: "mock-llm", mock: true },
  disclaimer: "This analysis is preliminary ... not financial, legal, investment ... advice.",
};

beforeEach(() => vi.restoreAllMocks());

describe("M&A Analyzer", () => {
  it("validates that the two companies differ before calling the API", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    wrap(<Analyzer />);
    fireEvent.change(screen.getByLabelText(/target company website/i), { target: { value: "same.com" } });
    fireEvent.change(screen.getByLabelText(/potential buyer website/i), { target: { value: "same.com" } });
    fireEvent.click(screen.getByRole("button", { name: /analyze fit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different companies/i);
    expect(f).not.toHaveBeenCalled();
  });

  it("renders score, provenance badges, unknowns, sources and disclaimer; escapes content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ report, saved: false }));
    const { container } = wrap(<Analyzer />);
    fireEvent.change(screen.getByLabelText(/target company website/i), { target: { value: "target.example" } });
    fireEvent.change(screen.getByLabelText(/potential buyer website/i), { target: { value: "buyer.example" } });
    fireEvent.click(screen.getByRole("button", { name: /analyze fit/i }));
    expect(await screen.findByText("64")).toBeInTheDocument();
    expect(screen.getAllByText("Sourced").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No reliable revenue data")[0]).toBeInTheDocument();
    expect(screen.getByText("Target home")).toBeInTheDocument();
    expect(screen.getByText(/not financial, legal, investment/)).toBeInTheDocument();
    expect(screen.getByText(/without an AI provider/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull(); // injected markup rendered as text
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ targetUrl: "https://target.example", buyerUrl: "https://buyer.example", saveConsent: false });
  });

  it("shows API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "Too many requests. Please try again later." }, 429));
    wrap(<Analyzer />);
    fireEvent.change(screen.getByLabelText(/target company website/i), { target: { value: "a.example" } });
    fireEvent.change(screen.getByLabelText(/potential buyer website/i), { target: { value: "b.example" } });
    fireEvent.click(screen.getByRole("button", { name: /analyze fit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many requests/i);
  });
});

describe("LeadForm", () => {
  it("submits consent and shows confirmation", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ received: true }));
    render(<LeadForm />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "pat@co.example" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: /send inquiry/i }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/received your note/i));
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ name: "Pat", consent: true, interest: "general" });
  });
});

describe("internal UI", () => {
  it("renders structured reports with provenance and citations", () => {
    render(<ReportBody content={{ overview: claim("Clinic software", "sourced", ["s1"]), questions: ["Timing?"] }} sources={[{ id: "s1" }]} />);
    expect(screen.getByText("Sourced")).toBeInTheDocument();
    expect(screen.getByText("[1]")).toHaveAttribute("href", "#src-s1");
    expect(screen.getByText("Timing?")).toBeInTheDocument();
  });
  it("labels email verification honestly", () => {
    render(<><EmailStatus status="unverified" /><EmailStatus status="provider_verified" /><StageBadge stage="nda" /></>);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("Verified (provider)")).toBeInTheDocument();
    expect(screen.getByText("NDA")).toBeInTheDocument();
  });
});
