import { z } from "zod";

/** Signals the scoring engine knows how to evaluate. Kept in sync with services/ai-research. */
export const SIGNALS = [
  "industry_overlap",
  "business_model_alignment",
  "product_synergy",
  "customer_overlap",
  "geographic_synergy",
  "scale_compatibility",
  "strategic_fit",
  "acquisition_criteria",
] as const;

export const matrixCriterion = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/).max(60),
  label: z.string().max(120),
  signal: z.enum(SIGNALS),
  weight: z.number().min(0).max(100),
  required: z.boolean().default(false),
  params: z.record(z.unknown()).default({}),
});

export const exclusionRule = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/).max(60),
  description: z.string().max(300),
  field: z.enum(["industry", "geography", "business_model", "tags", "employee_range"]),
  operator: z.enum(["in", "not_in", "contains"]),
  values: z.array(z.string().max(100)).min(1),
  appliesTo: z.enum(["target", "buyer"]),
});

export const matrixModelInput = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/).max(60),
  name: z.string().max(120),
  description: z.string().max(1000).default(""),
  criteria: z.array(matrixCriterion).min(1).max(40),
  exclusions: z.array(exclusionRule).max(40).default([]),
  thresholds: z.object({ strong: z.number().min(0).max(100), moderate: z.number().min(0).max(100) }).default({ strong: 70, moderate: 45 }),
  minCoverage: z.number().min(0).max(1).default(0.5),
});
export type MatrixModelInput = z.infer<typeof matrixModelInput>;

export const DEFAULT_MATRIX: MatrixModelInput = {
  key: "default-ma-matrix",
  name: "Tuck Default M&A Matrix",
  description: "Balanced strategic-fit matrix for lower middle-market software and services deals.",
  criteria: [
    { key: "industry", label: "Industry overlap", signal: "industry_overlap", weight: 20, required: true, params: {} },
    { key: "model", label: "Business model alignment", signal: "business_model_alignment", weight: 15, required: false, params: {} },
    { key: "products", label: "Product & service synergy", signal: "product_synergy", weight: 20, required: false, params: {} },
    { key: "customers", label: "Customer overlap", signal: "customer_overlap", weight: 15, required: false, params: {} },
    { key: "geo", label: "Geographic synergy", signal: "geographic_synergy", weight: 10, required: false, params: {} },
    { key: "scale", label: "Scale compatibility", signal: "scale_compatibility", weight: 10, required: false, params: {} },
    { key: "strategy", label: "Strategic fit", signal: "strategic_fit", weight: 10, required: false, params: {} },
  ],
  exclusions: [],
  thresholds: { strong: 70, moderate: 45 },
  minCoverage: 0.5,
};

/** Facts handed to the scoring engine. Only verified/sourced values belong here; unknowns stay null. */
export const scoringFacts = z.object({
  name: z.string(),
  industry: z.string().nullable(),
  industryKeywords: z.array(z.string()).default([]),
  businessModel: z.string().nullable(),
  products: z.array(z.string()).default([]),
  customerSegments: z.array(z.string()).default([]),
  geographies: z.array(z.string()).default([]),
  employeeCount: z.number().nullable().default(null),
  revenueUsd: z.number().nullable().default(null),
  revenueVerified: z.boolean().default(false),
  strategicThemes: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  evidence: z.record(z.array(z.string())).default({}),
});
export type ScoringFacts = z.infer<typeof scoringFacts>;
