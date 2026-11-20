import type { Env, IntegrationStatus } from "./core";

interface Def {
  provider: string;
  label: string;
  category: "ai" | "research" | "enrichment" | "crm" | "communications" | "automation" | "infrastructure";
  required: string[];
  /** What happens when not configured. */
  fallback: "mock" | "disabled" | "website-only";
  docs: string;
}

export const INTEGRATIONS: Def[] = [
  { provider: "openai", label: "OpenAI", category: "ai", required: ["OPENAI_API_KEY"], fallback: "mock", docs: "https://platform.openai.com/docs" },
  { provider: "exa", label: "Exa AI", category: "research", required: ["EXA_API_KEY"], fallback: "website-only", docs: "https://docs.exa.ai" },
  { provider: "scoring_service", label: "Fit Score service (Python)", category: "ai", required: ["SCORING_SERVICE_URL"], fallback: "disabled", docs: "services/ai-research/README.md" },
  { provider: "apollo", label: "Apollo", category: "enrichment", required: ["APOLLO_API_KEY"], fallback: "mock", docs: "https://docs.apollo.io" },
  { provider: "rocketreach", label: "RocketReach", category: "enrichment", required: ["ROCKETREACH_API_KEY"], fallback: "mock", docs: "https://rocketreach.co/api/docs" },
  { provider: "pipeline_crm", label: "Pipeline CRM", category: "crm", required: ["PIPELINE_CRM_API_KEY"], fallback: "mock", docs: "https://app.pipelinecrm.com/api/docs" },
  { provider: "resend", label: "Resend", category: "communications", required: ["RESEND_API_KEY"], fallback: "mock", docs: "https://resend.com/docs" },
  { provider: "resend_webhooks", label: "Resend webhooks", category: "communications", required: ["RESEND_WEBHOOK_SECRET"], fallback: "disabled", docs: "https://resend.com/docs/dashboard/webhooks/introduction" },
  { provider: "google", label: "Google OAuth (Gmail / Docs)", category: "communications", required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"], fallback: "disabled", docs: "https://developers.google.com/identity/protocols/oauth2/web-server" },
  { provider: "reddit", label: "Reddit Data API", category: "research", required: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], fallback: "mock", docs: "https://www.reddit.com/dev/api" },
  { provider: "webhooks", label: "Zapier / Apps Script webhooks", category: "automation", required: ["WEBHOOK_SIGNING_SECRET"], fallback: "disabled", docs: "docs/automation-engine.md" },
  { provider: "supabase", label: "Supabase Auth", category: "infrastructure", required: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], fallback: "disabled", docs: "docs/setup.md" },
  { provider: "postgres", label: "PostgreSQL (Supabase / Cloud SQL)", category: "infrastructure", required: ["DATABASE_URL"], fallback: "mock", docs: "docs/database-design.md" },
];

/** Reports which integrations are live, mocked or disabled — names of missing env vars only, never values. */
export function integrationStatuses(env: Env): (IntegrationStatus & { label: string; category: string; missing: string[]; docs: string })[] {
  return INTEGRATIONS.map((d) => {
    const missing = d.required.filter((k) => !env[k]);
    const mode = missing.length === 0 ? "live" : d.fallback === "disabled" ? "disabled" : "mock";
    const reason =
      missing.length === 0
        ? undefined
        : d.fallback === "website-only"
          ? "Falls back to direct public-website retrieval (no web search)"
          : d.provider === "postgres"
            ? "Using embedded PGlite database (local development only)"
            : d.fallback === "mock"
              ? "Using local mock provider — no external calls are made"
              : "Disabled until configured";
    return { provider: d.provider, label: d.label, category: d.category, mode, reason, missing, docs: d.docs };
  });
}
