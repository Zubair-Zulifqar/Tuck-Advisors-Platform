import { z } from "zod";

/** A retrieved document from an authorised research provider (Exa, company site, Reddit API...). */
export const researchSource = z.object({
  id: z.string().min(1).max(64),
  url: z.string().url(),
  title: z.string().max(500).default(""),
  provider: z.string().max(40),
  retrievedAt: z.string().datetime(),
  excerpt: z.string().max(4000).default(""),
  publishedAt: z.string().datetime().optional(),
});
export type ResearchSource = z.infer<typeof researchSource>;

/**
 * Every statement in a report carries provenance. "sourced" statements MUST cite at least one
 * retrieved source id. "assessment" statements are AI interpretation. "unknown" means the data
 * could not be found and must not be filled in.
 */
export const PROVENANCE = ["sourced", "assessment", "unknown"] as const;
export const claim = z
  .object({
    text: z.string().max(2000),
    provenance: z.enum(PROVENANCE),
    sourceIds: z.array(z.string()).default([]),
    confidence: z.enum(["low", "medium", "high"]).default("medium"),
  })
  .refine((c) => c.provenance !== "sourced" || c.sourceIds.length > 0, {
    message: "Sourced claims must cite at least one source",
  });
export type Claim = z.infer<typeof claim>;

export const companyProfile = z.object({
  name: z.string().max(200),
  url: z.string().url(),
  overview: claim,
  industry: claim,
  businessModel: claim,
  productsAndServices: z.array(claim).max(20),
  customerSegments: z.array(claim).max(20),
  marketPositioning: claim,
  geography: claim,
  revenueIndicators: claim,
  growthIndicators: z.array(claim).max(20).default([]),
});
export type CompanyProfile = z.infer<typeof companyProfile>;

export const matrixCellResult = z.object({
  criterionKey: z.string(),
  label: z.string(),
  weight: z.number(),
  score: z.number().min(0).max(1).nullable(),
  contribution: z.number(),
  rationale: z.string(),
  evidence: z.array(z.string()).default([]),
  missing: z.boolean(),
});
export type MatrixCellResult = z.infer<typeof matrixCellResult>;

export const fitScoreResult = z.object({
  modelKey: z.string(),
  modelVersion: z.number().int(),
  score: z.number().min(0).max(100).nullable(),
  grade: z.enum(["strong", "moderate", "weak", "excluded", "insufficient_data"]),
  confidence: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
  cells: z.array(matrixCellResult),
  exclusions: z.array(z.object({ ruleKey: z.string(), reason: z.string() })),
  explanation: z.array(z.string()),
});
export type FitScoreResult = z.infer<typeof fitScoreResult>;

export const analyzerRequest = z.object({
  targetUrl: z.string().trim().url().max(2048),
  buyerUrl: z.string().trim().url().max(2048),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  saveConsent: z.boolean().default(false),
});
export type AnalyzerRequest = z.infer<typeof analyzerRequest>;

export const analyzerReport = z.object({
  id: z.string().uuid().optional(),
  generatedAt: z.string().datetime(),
  target: companyProfile,
  buyer: companyProfile,
  strategicFit: z.array(claim),
  synergies: z.array(claim),
  marketExpansion: z.array(claim),
  acquisitionRationale: z.array(claim),
  risks: z.array(claim),
  considerations: z.array(claim),
  fit: fitScoreResult,
  sources: z.array(researchSource),
  providers: z.object({ research: z.string(), llm: z.string(), mock: z.boolean() }),
  disclaimer: z.string(),
});
export type AnalyzerReport = z.infer<typeof analyzerReport>;

export const ANALYZER_DISCLAIMER =
  "This analysis is preliminary, generated from publicly available information and AI interpretation. " +
  "It is not financial, legal, investment, tax or valuation advice. Items marked as assessments are AI opinions, " +
  "not verified facts. Verify all information independently before relying on it.";

/** Rejects private/loopback hosts and non-http(s) schemes before any server-side fetch (SSRF guard). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h === "localhost") return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224)
      return false;
  }
  if (h.startsWith("[")) return false;
  return true;
}

export const capitalRaiseSignal = z.object({
  summary: z.string().max(1000),
  status: z.enum(["possible", "likely", "confirmed_by_source"]),
  confidence: z.enum(["low", "medium", "high"]),
  amountText: z.string().max(100).optional(),
  roundText: z.string().max(60).optional(),
  sourceIds: z.array(z.string()).min(1),
  needsHumanReview: z.literal(true).default(true),
});
export type CapitalRaiseSignal = z.infer<typeof capitalRaiseSignal>;

export const RESEARCH_KINDS = [
  "business_overview",
  "positioning_statement",
  "capital_raise",
  "acquisition_analysis",
  "pre_call_notes",
  "post_call_notes",
  "buyer_classification",
  "similar_companies",
  "reddit_signals",
  "ma_analyzer",
] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
