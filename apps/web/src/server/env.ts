import "server-only";

const e = process.env;

/** Server-only configuration. Nothing here is ever sent to the browser or bundled into the extension. */
export const env = {
  NODE_ENV: e.NODE_ENV ?? "development",
  APP_URL: e.APP_URL ?? "http://localhost:3000",
  DATABASE_URL: e.DATABASE_URL,
  PGLITE_DIR: e.PGLITE_DIR,
  AUTO_MIGRATE: e.AUTO_MIGRATE,
  ALLOW_EMBEDDED_DB: e.ALLOW_EMBEDDED_DB,
  SEED_PASSWORD: e.SEED_PASSWORD,
  WORKER_INLINE: e.WORKER_INLINE,
  /** HMAC key for session and extension access tokens. Required in production. */
  SESSION_SECRET: e.SESSION_SECRET ?? (e.NODE_ENV === "production" ? undefined : "dev-only-insecure-session-secret-change-me"),
  CRON_SECRET: e.CRON_SECRET,
  PUBLIC_ORG_SLUG: e.PUBLIC_ORG_SLUG ?? "tuck-advisors",
  EXTENSION_IDS: (e.EXTENSION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  SUPABASE_URL: e.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  WEBHOOK_SIGNING_SECRET: e.WEBHOOK_SIGNING_SECRET,
  RESEND_WEBHOOK_SECRET: e.RESEND_WEBHOOK_SECRET,
  INTEGRATION_ENCRYPTION_KEY: e.INTEGRATION_ENCRYPTION_KEY,
};

export function requireSessionSecret(): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be set (min 32 chars)");
  return env.SESSION_SECRET;
}
