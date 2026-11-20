import { z } from "zod";
import {
  ANALYZER_DISCLAIMER,
  DEFAULT_MATRIX,
  type AnalyzerReport,
  type Claim,
  type CompanyProfile,
  type FitScoreResult,
  type MatrixModelInput,
  type ResearchSource,
  capitalRaiseSignal,
  claim,
  companyProfile,
  isPublicHttpUrl,
  normalizeDomain,
} from "@tuck/shared";
import { IntegrationError } from "@tuck/integrations";
import type { EngineDeps } from "../deps";
import { heuristicProfile, keywords, profileToFacts } from "./heuristics";

const SYSTEM = `You are a senior M&A research analyst at Tuck Advisors. You write precise, neutral, evidence-backed analysis.
Rules:
- Each claim object has {text, provenance, sourceIds, confidence}.
- provenance "sourced" ONLY when the statement is directly supported by a provided source; list those source ids.
- provenance "assessment" for your professional interpretation.
- provenance "unknown" when information is not available. Never guess revenue, headcount, valuation, ownership or deal history.
- confidence is "low" | "medium" | "high".`;

function sourcesBlock(sources: ResearchSource[]) {
  return JSON.stringify(sources.map((s) => ({ id: s.id, url: s.url, title: s.title, publishedAt: s.publishedAt, excerpt: s.excerpt.slice(0, 2500) })));
}

/** Drop sourceIds the model invented; downgrade "sourced" claims that lose all citations. */
export function sanitizeClaims<T>(value: T, validIds: Set<string>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = { ...(v as Record<string, unknown>) };
      if ("provenance" in o && Array.isArray(o.sourceIds)) {
        o.sourceIds = (o.sourceIds as string[]).filter((id) => validIds.has(id));
        if (o.provenance === "sourced" && !(o.sourceIds as string[]).length) {
          o.provenance = "assessment";
          o.confidence = "low";
        }
        return o;
      }
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

// ------------------------------------------------------------------ retrieval
export async function gatherCompanySources(deps: EngineDeps, url: string, name?: string): Promise<ResearchSource[]> {
  if (!isPublicHttpUrl(url)) throw new IntegrationError("Company URL must be a public http(s) address", "research", 400);
  const u = new URL(url);
  const pages = [u.origin + "/", ...(u.pathname !== "/" ? [url] : []), `${u.origin}/about`];
  const direct = await deps.research.getContents([...new Set(pages)]);
  let extra: ResearchSource[] = [];
  if (deps.research.hasSearch) {
    const domain = normalizeDomain(url);
    extra = await deps.research.search(`${name ?? domain} company overview products customers`, { numResults: 5 }).catch((e) => {
      deps.logger.warn("research.search_failed", { error: (e as Error).message });
      return [];
    });
  }
  const seen = new Set<string>();
  return [...direct, ...extra].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).slice(0, 10);
}

// ------------------------------------------------------------------ business overview / profile
export async function buildCompanyProfile(deps: EngineDeps, url: string, sources: ResearchSource[], nameHint?: string): Promise<CompanyProfile> {
  const name = nameHint ?? sources[0]?.title.split(/[|\-–—:]/)[0]?.trim() ?? normalizeDomain(url) ?? url;
  const out = await deps.llm.completeJson(
    companyProfile,
    {
      task: "company_profile",
      system: SYSTEM,
      user: `Build a structured business profile for the company at ${url}${nameHint ? ` (${nameHint})` : ""}.
Return JSON with keys: name, url, overview, industry, businessModel, productsAndServices[], customerSegments[], marketPositioning, geography, revenueIndicators, growthIndicators[] — each a claim object.
revenueIndicators must be "unknown" unless a source explicitly states revenue figures (then quote and cite).
Sources: ${sourcesBlock(sources)}`,
    },
    () => heuristicProfile(name || url, url, sources),
  );
  return sanitizeClaims({ ...out, url }, new Set(sources.map((s) => s.id)));
}

// ------------------------------------------------------------------ positioning statement
export const positioningOutput = z.object({
  statement: z.string().min(1).max(1200),
  targetCustomer: claim,
  category: claim,
  differentiators: z.array(claim).max(6),
  proofPoints: z.array(claim).max(6),
});
export async function positioningStatement(deps: EngineDeps, profile: CompanyProfile, sources: ResearchSource[]) {
  const out = await deps.llm.completeJson(
    positioningOutput,
    {
      task: "positioning_statement",
      system: SYSTEM,
      user: `Write a crisp positioning statement for ${profile.name} using the form "For <target customer> who <need>, <company> is a <category> that <key benefit>. Unlike <alternative>, it <differentiator>."
Only use differentiators supported by the sources; otherwise mark them as assessments.
Profile: ${JSON.stringify(profile)}
Sources: ${sourcesBlock(sources)}`,
    },
    () => {
      const seg = profile.customerSegments[0]?.text ?? "its customers";
      const cat = profile.industry.provenance === "unknown" ? "company" : `${profile.industry.text} company`;
      return {
        statement: `For ${seg.toLowerCase()}, ${profile.name} is a ${cat}${profile.overview.provenance !== "unknown" ? ` focused on: ${profile.overview.text}` : ""}. [Draft generated without an AI provider — refine before use.]`,
        targetCustomer: profile.customerSegments[0] ?? { text: "Not determinable from sources", provenance: "unknown", sourceIds: [], confidence: "low" },
        category: profile.industry,
        differentiators: [],
        proofPoints: profile.overview.provenance === "sourced" ? [profile.overview] : [],
      };
    },
  );
  return sanitizeClaims(out, new Set(sources.map((s) => s.id)));
}

// ------------------------------------------------------------------ capital raise detection
export const capitalRaiseOutput = z.object({ signals: z.array(capitalRaiseSignal).max(10), summary: z.string().max(1500) });
const RAISE_RE = /\b(raise[sd]?|raising|funding round|series [a-f]|seed round|pre-seed|growth equity|investment from|led by|closes? \$?\d)/i;

export async function detectCapitalRaise(deps: EngineDeps, companyName: string, domain: string | null) {
  const query = `${companyName} ${domain ?? ""} raises funding round investment`;
  const sources = await deps.research.search(query, { numResults: 8, category: "news", startPublishedDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 730).toISOString() });
  const relevant = sources.filter((s) => s.excerpt.toLowerCase().includes(companyName.toLowerCase().split(" ")[0]!));
  const out = await deps.llm.completeJson(
    capitalRaiseOutput,
    {
      task: "capital_raise",
      system: SYSTEM,
      user: `Identify publicly reported fundraising activity for "${companyName}" (${domain ?? "domain unknown"}).
For each distinct event return {summary, status, confidence, amountText?, roundText?, sourceIds, needsHumanReview:true}.
status "confirmed_by_source" ONLY when a source explicitly reports a closed round for THIS company; "likely" for strong but indirect evidence; otherwise "possible".
Ignore other companies with similar names. If nothing relevant, return an empty signals array.
Sources: ${sourcesBlock(relevant)}`,
    },
    () => ({
      signals: relevant
        .filter((s) => RAISE_RE.test(s.excerpt))
        .slice(0, 5)
        .map((s) => ({
          summary: `${s.title}: ${s.excerpt.slice(0, 280)}`,
          status: "possible" as const,
          confidence: "low" as const,
          amountText: /\$\s?\d[\d.,]*\s?(million|m|billion|bn)?/i.exec(s.excerpt)?.[0],
          roundText: /\b(series [a-f]|seed|pre-seed|growth)\b/i.exec(s.excerpt)?.[0],
          sourceIds: [s.id],
          needsHumanReview: true as const,
        })),
      summary: deps.research.hasSearch
        ? "Keyword-based screening of retrieved news. All signals require human verification."
        : "No web search provider configured (EXA_API_KEY). Capital raise detection could not search news sources.",
    }),
  );
  const valid = new Set(relevant.map((s) => s.id));
  const signals = out.signals
    .map((s) => ({ ...s, sourceIds: s.sourceIds.filter((id) => valid.has(id)), needsHumanReview: true as const }))
    .filter((s) => s.sourceIds.length > 0);
  return { signals, summary: out.summary, sources: relevant };
}

// ------------------------------------------------------------------ pre / post call notes
export const preCallOutput = z.object({
  companyBackground: z.array(claim).max(8),
  contactBackground: z.array(claim).max(6),
  recentDevelopments: z.array(claim).max(8),
  acquisitionInterests: z.array(claim).max(6),
  discussionPoints: z.array(z.string().max(400)).max(10),
  questions: z.array(z.string().max(400)).max(12),
  crmHistory: z.array(z.string().max(400)).max(12),
});

export async function preCallNotes(
  deps: EngineDeps,
  input: {
    company: { name: string; industry: string | null; description: string | null; website: string | null };
    contact?: { name: string; title: string | null } | null;
    history: { type: string; subject: string; occurred_at: string }[];
    sources: ResearchSource[];
  },
) {
  const out = await deps.llm.completeJson(
    preCallOutput,
    {
      task: "pre_call_notes",
      system: SYSTEM,
      user: `Prepare a pre-call brief for a Tuck Advisors banker meeting ${input.contact ? `${input.contact.name} (${input.contact.title ?? "title unknown"})` : "the team"} at ${input.company.name}.
Include companyBackground, contactBackground (only what is in CRM/sources — no personal details beyond professional role), recentDevelopments, acquisitionInterests, discussionPoints, questions, crmHistory (short bullet summaries of the CRM timeline).
CRM company: ${JSON.stringify(input.company)}
CRM timeline: ${JSON.stringify(input.history.slice(0, 25))}
Sources: ${sourcesBlock(input.sources)}`,
    },
    () => ({
      companyBackground: [
        input.company.description
          ? { text: input.company.description.slice(0, 500), provenance: "assessment" as const, sourceIds: [], confidence: "medium" as const }
          : { text: "No company description on file.", provenance: "unknown" as const, sourceIds: [], confidence: "low" as const },
        ...input.sources.slice(0, 2).map((s) => ({ text: `${s.title}: ${s.excerpt.slice(0, 240)}`, provenance: "sourced" as const, sourceIds: [s.id], confidence: "medium" as const })),
      ],
      contactBackground: input.contact
        ? [{ text: `${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""} (from CRM)`, provenance: "assessment" as const, sourceIds: [], confidence: "medium" as const }]
        : [],
      recentDevelopments: [],
      acquisitionInterests: [],
      discussionPoints: ["Current strategic priorities and growth plans", "Ownership goals and timing", "Appetite for acquisitions or partnerships"],
      questions: ["What would an ideal outcome look like in the next 12–24 months?", "Who else is involved in strategic decisions?", "Are there any recent inbound approaches?"],
      crmHistory: input.history.slice(0, 10).map((h) => `${h.occurred_at.slice(0, 10)} · ${h.type} · ${h.subject}`),
    }),
  );
  return sanitizeClaims(out, new Set(input.sources.map((s) => s.id)));
}

export const postCallOutput = z.object({
  summary: z.string().max(3000),
  keyPoints: z.array(z.string().max(500)).max(15),
  actionItems: z.array(z.object({ title: z.string().max(300), owner: z.string().max(100).optional(), dueInDays: z.number().int().min(0).max(365).optional() })).max(15),
  opportunities: z.array(z.string().max(500)).max(10),
  followUps: z.array(z.string().max(500)).max(10),
  crmUpdates: z
    .array(z.object({ field: z.enum(["deal_stage", "industry", "tags", "description"]), value: z.string().max(500), reason: z.string().max(300) }))
    .max(10),
});

export async function postCallNotes(deps: EngineDeps, transcript: string, context: { companyName?: string }) {
  const clean = transcript.slice(0, 40_000);
  return deps.llm.completeJson(
    postCallOutput,
    {
      task: "post_call_notes",
      system: SYSTEM,
      user: `Turn these meeting notes / transcript${context.companyName ? ` with ${context.companyName}` : ""} into: summary, keyPoints, actionItems (title, owner if stated, dueInDays if stated), opportunities, followUps, crmUpdates (suggestions only; a human approves them).
Notes:
"""${clean}"""`,
    },
    () => {
      const lines = clean.split(/\r?\n|(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean);
      const actions = lines.filter((l) => /\b(will|to do|action|follow up|send|schedule|next step)\b/i.test(l)).slice(0, 10);
      return {
        summary: lines.slice(0, 3).join(" ").slice(0, 1200) || "No notes provided.",
        keyPoints: lines.filter((l) => l.length > 25).slice(0, 8),
        actionItems: actions.map((a) => ({ title: a.slice(0, 280) })),
        opportunities: lines.filter((l) => /\b(acqui|sell|buyer|exit|merger|invest|partnership)/i.test(l)).slice(0, 5),
        followUps: actions.slice(0, 3).map((a) => `Follow up: ${a.slice(0, 200)}`),
        crmUpdates: [],
      };
    },
  );
}

// ------------------------------------------------------------------ acquisition analysis / discovery
export async function discoverSimilarCompanies(deps: EngineDeps, url: string, n = 8) {
  if (!deps.research.hasSearch) return { companies: [], note: "Company discovery requires a search provider (EXA_API_KEY)." };
  const res = await deps.research.findSimilar(url, n);
  return {
    companies: res.map((s) => ({ name: s.title.split(/[|\-–—:]/)[0]?.trim() || normalizeDomain(s.url), url: s.url, domain: normalizeDomain(s.url), excerpt: s.excerpt.slice(0, 300), sourceId: s.id })),
    sources: res,
    note: null,
  };
}

export async function discoverBuyers(deps: EngineDeps, profile: CompanyProfile, n = 8) {
  if (!deps.research.hasSearch) return { candidates: [], sources: [], note: "Buyer discovery requires a search provider (EXA_API_KEY)." };
  const theme = profile.industry.provenance === "unknown" ? profile.name : profile.industry.text;
  const sources = await deps.research.search(`companies that acquired ${theme} businesses acquisition announcement`, { numResults: n, category: "news" });
  return {
    candidates: sources.map((s) => ({ title: s.title, url: s.url, excerpt: s.excerpt.slice(0, 300), sourceId: s.id, note: "Candidate from news search — verify acquirer identity and history." })),
    sources,
    note: null,
  };
}

// ------------------------------------------------------------------ fit scoring
export function insufficientFit(model: MatrixModelInput & { version: number }, reason: string): FitScoreResult {
  return {
    modelKey: model.key,
    modelVersion: model.version,
    score: null,
    grade: "insufficient_data",
    confidence: 0,
    coverage: 0,
    cells: [],
    exclusions: [],
    explanation: [reason],
  };
}

export async function scoreProfiles(
  deps: EngineDeps,
  model: MatrixModelInput & { version: number },
  buyer: CompanyProfile,
  target: CompanyProfile,
): Promise<FitScoreResult> {
  if (!deps.scoring) return insufficientFit(model, "Fit Score service is not configured (SCORING_SERVICE_URL). No score was calculated.");
  try {
    return await deps.scoring.score(model, profileToFacts(buyer), profileToFacts(target));
  } catch (e) {
    deps.logger.error("scoring.failed", { error: (e as Error).message });
    return insufficientFit(model, "The Fit Score service could not be reached. No score was calculated.");
  }
}

// ------------------------------------------------------------------ public M&A Analyzer
export const analyzerNarrative = z.object({
  strategicFit: z.array(claim).max(6),
  synergies: z.array(claim).max(8),
  marketExpansion: z.array(claim).max(6),
  acquisitionRationale: z.array(claim).max(6),
  risks: z.array(claim).max(8),
  considerations: z.array(claim).max(8),
});

function narrativeFromScore(fit: FitScoreResult, buyer: CompanyProfile, target: CompanyProfile): z.input<typeof analyzerNarrative> {
  const a = (text: string): Claim => ({ text, provenance: "assessment", sourceIds: [], confidence: "low" });
  const cells = fit.cells.filter((c) => !c.missing && c.score !== null);
  const strong = cells.filter((c) => (c.score ?? 0) >= 0.6);
  const weak = cells.filter((c) => (c.score ?? 0) < 0.35);
  const missing = fit.cells.filter((c) => c.missing);
  return {
    strategicFit: [a(fit.explanation[0] ?? "Strategic fit could not be scored.")],
    synergies: strong.map((c) => a(`${c.label}: ${c.rationale}`)),
    marketExpansion:
      buyer.geography.provenance !== "unknown" && target.geography.provenance !== "unknown"
        ? [a(`Buyer footprint (${buyer.geography.text}) vs. target footprint (${target.geography.text}).`)]
        : [a("Geographic footprint data was insufficient to assess market expansion.")],
    acquisitionRationale: strong.length
      ? [a(`The strongest rationale rests on ${strong.map((s) => s.label.toLowerCase()).join(", ")}.`)]
      : [a("No strong acquisition rationale emerged from the available public information.")],
    risks: [
      ...weak.map((c) => a(`Low ${c.label.toLowerCase()}: ${c.rationale}`)),
      ...missing.map((c) => a(`Unverified: ${c.label} — data unavailable.`)),
      ...fit.exclusions.map((x) => a(`Exclusion rule triggered: ${x.reason}`)),
    ],
    considerations: [
      a("Revenue, profitability and ownership were not verified and must be confirmed in diligence."),
      a("Validate customer overlap and cross-sell assumptions with management interviews."),
    ],
  };
}

export async function runAnalyzer(deps: EngineDeps, input: { targetUrl: string; buyerUrl: string }, model = { ...DEFAULT_MATRIX, version: 1 }): Promise<AnalyzerReport> {
  for (const u of [input.targetUrl, input.buyerUrl]) if (!isPublicHttpUrl(u)) throw new IntegrationError("Both URLs must be public http(s) website addresses", "analyzer", 400);
  if (normalizeDomain(input.targetUrl) === normalizeDomain(input.buyerUrl)) throw new IntegrationError("Target and buyer must be different companies", "analyzer", 400);
  const [tSources, bSources] = await Promise.all([gatherCompanySources(deps, input.targetUrl), gatherCompanySources(deps, input.buyerUrl)]);
  const [target, buyer] = await Promise.all([buildCompanyProfile(deps, input.targetUrl, tSources), buildCompanyProfile(deps, input.buyerUrl, bSources)]);
  const fit = await scoreProfiles(deps, model, buyer, target);
  const sources = [...tSources, ...bSources];
  const narrative = sanitizeClaims(
    await deps.llm.completeJson(
      analyzerNarrative,
      {
        task: "ma_analyzer",
        system: SYSTEM,
        user: `Assess a potential acquisition of TARGET by BUYER. Use the deterministic matrix score below as the quantitative anchor; do not contradict it.
Return strategicFit, synergies, marketExpansion, acquisitionRationale, risks, considerations — arrays of claim objects.
TARGET profile: ${JSON.stringify(target)}
BUYER profile: ${JSON.stringify(buyer)}
Matrix result: ${JSON.stringify(fit)}
Sources: ${sourcesBlock(sources)}`,
      },
      () => narrativeFromScore(fit, buyer, target),
    ),
    new Set(sources.map((s) => s.id)),
  );
  return {
    generatedAt: deps.now().toISOString(),
    target,
    buyer,
    ...narrative,
    fit,
    sources,
    providers: { research: deps.research.name, llm: deps.llm.name, mock: deps.llm.mock },
    disclaimer: ANALYZER_DISCLAIMER,
  };
}

export { keywords };
