/**
 * Deterministic, explainable extraction used (a) by the mock LLM provider in local development and
 * (b) to derive scoring facts. Anything detected from page text is "sourced" with the source id; any
 * interpretation is an "assessment" with low confidence; anything not found is "unknown".
 */
import type { Claim, CompanyProfile, ResearchSource, ScoringFacts } from "@tuck/shared";

const INDUSTRIES: [string, RegExp][] = [
  ["Healthcare", /\b(health ?care|clinic(al|s)?|patient|hospital|medical|pharma)\b/i],
  ["Financial Services", /\b(fintech|bank(ing)?|payments?|lending|insurance|wealth|accounting)\b/i],
  ["Software", /\b(saas|software|platform|cloud|api|app)\b/i],
  ["Cybersecurity", /\b(security|cyber|threat|compliance|identity)\b/i],
  ["Manufacturing", /\b(manufactur(ing|er)|industrial|factory|fabrication)\b/i],
  ["Logistics", /\b(logistics|freight|shipping|supply chain|warehous)/i],
  ["Construction & Trades", /\b(construction|hvac|plumbing|roofing|electrical contractor)\b/i],
  ["Marketing & Media", /\b(marketing|advertis(ing|ers)|agency|media|content)\b/i],
  ["Education", /\b(education|learning|students?|school|training)\b/i],
  ["Real Estate", /\b(real estate|property|properties|leasing)\b/i],
  ["Energy", /\b(energy|solar|renewable|utilities|oil|gas)\b/i],
  ["Retail & E-commerce", /\b(e-?commerce|retail|shop|store|consumer brand)\b/i],
  ["Professional Services", /\b(consulting|advisory|staffing|legal services|professional services)\b/i],
];

const MODELS: [string, RegExp][] = [
  ["Subscription software (SaaS)", /\b(saas|subscription|per seat|pricing plans?|free trial)\b/i],
  ["Marketplace", /\b(marketplace|buyers and sellers|two-sided)\b/i],
  ["Managed / professional services", /\b(managed services|consulting|agency|we help|our team of experts)\b/i],
  ["Product / manufacturing", /\b(manufactur|products? (line|catalog)|distributor|wholesale)\b/i],
  ["Transactional / payments", /\b(transaction fees?|payments? processing)\b/i],
];

const SEGMENTS: [string, RegExp][] = [
  ["Enterprise", /\b(enterprise|fortune 500|large organizations)\b/i],
  ["Small & mid-sized businesses", /\b(small business(es)?|smb|mid-?market|growing teams)\b/i],
  ["Healthcare providers", /\b(clinics?|hospitals?|providers|practices)\b/i],
  ["Government / public sector", /\b(government|public sector|municipal)\b/i],
  ["Consumers", /\b(consumers?|households|individuals|families)\b/i],
  ["Financial institutions", /\b(banks|credit unions|lenders|insurers)\b/i],
];

const GEOS = ["United States", "Canada", "United Kingdom", "Europe", "Germany", "France", "Australia", "India", "Latin America", "Asia", "Middle East", "North America", "EMEA", "APAC"];

const STOP = new Set("the and for with our your you are from that this into more than have has was were will can all its it's their they them about using use any not but who what how when where which while also new best we us of to in on a an or by as at is be".split(" "));

export function keywords(text: string, max = 40): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

const unknown = (text: string): Claim => ({ text, provenance: "unknown", sourceIds: [], confidence: "low" });

export function heuristicProfile(name: string, url: string, sources: ResearchSource[]): CompanyProfile {
  const primary = sources[0];
  const corpus = sources.map((s) => `${s.title} ${s.excerpt}`).join(" \n ");
  const ids = sources.map((s) => s.id);
  const firstSentence = primary?.excerpt.split(" — ")[0]?.split(/(?<=\.)\s/)[0]?.trim();
  const match = <T extends string>(table: [T, RegExp][]) => table.filter(([, re]) => re.test(corpus)).map(([k]) => k);
  const industries = match(INDUSTRIES);
  const models = match(MODELS);
  const segs = match(SEGMENTS);
  const geos = GEOS.filter((g) => new RegExp(`\\b${g}\\b`, "i").test(corpus));
  return {
    name,
    url,
    overview: firstSentence
      ? { text: firstSentence.slice(0, 600), provenance: "sourced", sourceIds: primary ? [primary.id] : [], confidence: "medium" }
      : unknown("No public description could be retrieved for this company."),
    industry: industries.length
      ? { text: industries.slice(0, 2).join(" / "), provenance: "assessment", sourceIds: ids, confidence: "low" }
      : unknown("Industry could not be determined from available sources."),
    businessModel: models.length
      ? { text: models[0]!, provenance: "assessment", sourceIds: ids, confidence: "low" }
      : unknown("Business model not determinable from available sources."),
    productsAndServices: keywords(primary?.title ?? "", 6).length
      ? [{ text: `Public materials emphasise: ${keywords(corpus, 8).join(", ")}`, provenance: "assessment", sourceIds: ids, confidence: "low" }]
      : [],
    customerSegments: segs.map((s) => ({ text: s, provenance: "assessment" as const, sourceIds: ids, confidence: "low" as const })),
    marketPositioning: unknown("Market positioning requires analyst review or an AI provider (OPENAI_API_KEY not configured)."),
    geography: geos.length
      ? { text: `Mentions ${geos.join(", ")}`, provenance: "sourced", sourceIds: ids, confidence: "low" }
      : unknown("Geographic presence not stated in retrieved sources."),
    revenueIndicators: unknown("No reliable public revenue information was found. Revenue is never estimated."),
    growthIndicators: [],
  };
}

/** Convert a profile to scoring facts. Only non-"unknown" claims contribute; revenue is never inferred. */
export function profileToFacts(p: CompanyProfile, extra: Partial<ScoringFacts> = {}): ScoringFacts {
  const known = (c: Claim) => (c.provenance === "unknown" ? null : c.text);
  const ev = (c: Claim | Claim[]) => (Array.isArray(c) ? c.flatMap((x) => x.sourceIds) : c.sourceIds);
  const corpus = [p.overview, p.industry, p.businessModel, p.marketPositioning, ...p.productsAndServices].filter((c) => c.provenance !== "unknown").map((c) => c.text).join(" ");
  return {
    name: p.name,
    industry: known(p.industry),
    industryKeywords: keywords(corpus, 25),
    businessModel: known(p.businessModel),
    products: p.productsAndServices.filter((c) => c.provenance !== "unknown").map((c) => c.text),
    customerSegments: p.customerSegments.filter((c) => c.provenance !== "unknown").map((c) => c.text),
    geographies: p.geography.provenance === "unknown" ? [] : p.geography.text.replace(/^Mentions /, "").split(/,\s*/),
    employeeCount: null,
    revenueUsd: null,
    revenueVerified: false,
    strategicThemes: keywords(p.marketPositioning.provenance === "unknown" ? "" : p.marketPositioning.text, 10),
    tags: [],
    evidence: {
      industry: ev(p.industry),
      businessModel: ev(p.businessModel),
      products: ev(p.productsAndServices),
      customerSegments: ev(p.customerSegments),
      geographies: ev(p.geography),
    },
    ...extra,
  };
}

const EMPLOYEE_RANGES: Record<string, number> = { "1-10": 5, "11-50": 30, "51-200": 120, "201-500": 350, "501-1000": 750, "1001-5000": 2500, "5001-10000": 7500, "10000+": 15000 };

/** Facts from a CRM company row (analyst-entered data). */
export function companyRowToFacts(c: {
  name: string;
  industry: string | null;
  tags: string[];
  headquarters: string | null;
  employee_range: string | null;
  description: string | null;
  custom_fields: Record<string, unknown>;
}): ScoringFacts {
  const cf = c.custom_fields ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(/\s*[,;]\s*/) : []);
  const revenueVerified = cf.revenue_verified === true || cf.revenue_verified === "true";
  return {
    name: c.name,
    industry: c.industry,
    industryKeywords: keywords(`${c.industry ?? ""} ${c.description ?? ""} ${c.tags.join(" ")}`, 25),
    businessModel: typeof cf.business_model === "string" ? cf.business_model : null,
    products: list(cf.products),
    customerSegments: list(cf.customer_segments),
    geographies: [c.headquarters, ...list(cf.geographies)].filter(Boolean) as string[],
    employeeCount: c.employee_range ? (EMPLOYEE_RANGES[c.employee_range] ?? null) : null,
    revenueUsd: revenueVerified && cf.revenue_usd != null ? Number(cf.revenue_usd) : null,
    revenueVerified,
    strategicThemes: list(cf.strategic_themes),
    tags: c.tags,
    evidence: {},
  };
}
