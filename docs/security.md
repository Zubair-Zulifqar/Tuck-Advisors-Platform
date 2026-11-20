# Security & privacy

## Authentication
- **Web:** `POST /api/auth/login` verifies scrypt hashes (`packages/db/src/passwords.ts`) or, for `auth_provider = 'supabase'`
  users, Supabase Auth's password grant. Issues an HMAC-SHA256 signed token (`SESSION_SECRET`, 12 h) in an `httpOnly`,
  `SameSite=Lax`, `Secure` (prod) cookie. Login is rate-limited per IP+email (8 / 15 min) with constant-ish timing for unknown users.
- **Extension:** `POST /api/extension/auth/login` → 15-minute bearer access token + 30-day refresh token. Refresh tokens are
  random, stored only as SHA-256 hashes, rotated on every use; presenting a revoked token revokes the user's entire extension
  token family (reuse detection). Logout revokes server-side.
- Memberships are re-read on each request, so revoking access is immediate.

## Authorization
Permissions (`packages/shared/src/roles.ts`):

| Permission | owner | admin | analyst | viewer |
| --- | :-: | :-: | :-: | :-: |
| crm:read | ✓ | ✓ | ✓ | ✓ |
| crm:write | ✓ | ✓ | ✓ | |
| crm:delete | ✓ | ✓ | | |
| research:run | ✓ | ✓ | ✓ | |
| outreach:draft | ✓ | ✓ | ✓ | |
| outreach:approve | ✓ | ✓ | | |
| automation:manage / automation:approve | ✓ | ✓ | | |
| newsletter:approve | ✓ | ✓ | | |
| integrations:manage | ✓ | ✓ | | |
| members:manage | ✓ | | | |
| audit:read | ✓ | ✓ | | |

Enforced in the API wrapper **and** by Postgres RLS (requests run as `authenticated`). Campaigns and newsletters additionally
require approval by someone other than the author.

## Input & output handling
- Zod validation on every body; parameterised SQL only; LIKE wildcards escaped; CSV export neutralises formula injection.
- React escapes all rendered text; the extension uses `textContent` only (tested for XSS).
- CSP: `default-src 'self'`, `frame-ancestors 'none'`, plus HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer/Permissions policies.

## CSRF & CORS
- Cookie-authenticated state changes require `Origin` host == request host.
- CORS only for `chrome-extension://<id>` origins (restricted to `EXTENSION_IDS`; required in production). Extension calls use
  bearer tokens and `credentials: "omit"`.

## Outbound requests (SSRF)
`isPublicHttpUrl` rejects non-http(s), credentials in URLs, localhost/private/link-local literals; `assertPublicHost` resolves DNS
and rejects any private address on **every redirect hop**; responses capped at 1.5 MB with timeouts; robots.txt honoured.

## Webhooks
- Resend: Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) with a 5-minute replay window, idempotent by event id.
- Zapier/Apps Script: `X-Tuck-Signature: t=<unix>,v1=<hmac(t.body)>`, 5-minute window, idempotent by `eventId`.
- Cron: bearer `CRON_SECRET`, constant-time compare.

## Secrets
- All provider keys are server-side environment variables; nothing secret is bundled into client JS or the extension.
- `INTEGRATION_ENCRYPTION_KEY` + `encryptSecret()` (AES-256-GCM) is provided for storing per-org credentials in `integrations.secret_ciphertext`.
- `.env*` files are git-ignored; `scripts/scan-secrets.mjs` runs in CI.

## Rate limiting
Per-user (default 240/min per route) and per-IP for public routes (analyzer 5/10 min, leads 5/10 min). In-memory; use Redis
for multiple instances.

## Privacy & platform rules
- Data minimisation: analyzer stores nothing without consent; Gmail logging sends subject, participants and thread id only.
- No scraping or automation of LinkedIn/Gmail; content scripts read only what the user is viewing and act only on clicks.
- Enrichment never marks guessed emails verified; the mock never fabricates contact data.
- No email or connection request is sent automatically; outreach requires approval, honours suppression/unsubscribe, adds
  `List-Unsubscribe`, enforces daily limits, and does not rotate sender identities.
- Audit triggers record actor and field diffs (password hashes and secret ciphertext are excluded).
