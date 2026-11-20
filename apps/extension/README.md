# Tuck Advisors Deal Workstation (Chrome extension, Manifest V3)

A side panel that turns supported pages into a deal workstation connected to the Tuck Advisors platform.

| Page | What the panel does |
| --- | --- |
| LinkedIn company (`linkedin.com/company/*`) | Shows the CRM record and color-coded deals if one exists; otherwise a review form, pre-filled from what's visible on the page, to create the company. Flags duplicates (by domain, LinkedIn URL or name), runs research only if you tick the box, and has a manual "Mark LinkedIn verified" button. |
| LinkedIn profile (`linkedin.com/in/*`) | Matches the contact, lets you create one and link it to a matching company, and runs enrichment through the approved providers on the server, showing a clear verification badge. Never sends connection requests or messages. |
| Gmail (open conversation only) | Matches participants against the CRM, shows deal-stage chips, can create contacts for unknown senders, and "Log this thread to CRM" (sends the subject, participant addresses and thread ID only). |
| Tuck CRM (configured platform origin) | AI Deal Toolkit: business overview, positioning, capital-raise signals, acquisition analysis, similar companies, buyer classification, pre/post-call notes, contact enrichment, AI Fit Score. |

## Build & load unpacked

```bash
# from the repo root (dependencies are installed by the root workspace)
cd apps/extension
TUCK_API_BASE_URL=http://localhost:3000 npm run build       # → dist/
npm run package                                            # → dist/tuck-advisors-extension.zip (Chrome Web Store upload)
npm test                                                   # vitest + jsdom (builds first)
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `apps/extension/dist`.
3. Click the toolbar icon → **Open deal workstation**, enter the platform URL and sign in. Chrome asks for access to that one origin.

`TUCK_API_BASE_URL` is only the default shown on the sign-in form; it contains no secrets. Production builds use `NODE_ENV=production` (minified, no source maps). Publishing to the Chrome Web Store is a manual step and is not automated.

## Permissions and why

| Permission | Reason |
| --- | --- |
| `sidePanel` | Shows the workstation UI in Chrome's side panel. |
| `storage` | `storage.session` holds the short-lived access token and per-tab page context (in memory, cleared when the browser closes, not readable by content scripts). `storage.local` holds the platform URL, the signed-in user's display info and the refresh token. |
| `optional_host_permissions` (`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`) | Nothing is granted at install. At sign-in the extension asks for **only the configured platform origin** (e.g. `https://app.tuckadvisors.com/*`) so it can call the API. |
| Content scripts on `linkedin.com/company/*`, `linkedin.com/in/*`, `mail.google.com/*` | Read-only parsing of the page the user has open. |

Not requested: `<all_urls>`, `tabs`, `cookies`, `webRequest`, `scripting`, `history`, `externally_connectable`, `web_accessible_resources`. The default MV3 content security policy is used and no remote code is loaded. Tests enforce all of this (`test/manifest.test.ts`).

## Data handling

- **Read-only content scripts.** They read text already rendered for the signed-in user and never click, scroll, auto-paginate, call private LinkedIn or Gmail APIs, or make network requests. A debounced `MutationObserver` re-parses after in-page (SPA) navigation.
- **Gmail:** only the open conversation's subject, participant addresses and thread ID are parsed. Message bodies, the inbox list and other threads are never read. Logging a thread sends just those fields, and the panel says so before you click.
- **Nothing is written without a click.** Every create, log, enrich or research action needs an explicit button press. The extension cannot send email, LinkedIn messages or invitations.
- **Unverified data stays labeled.** Manually entered or guessed emails are saved as `unverified`. Only the server can set `provider_verified`, after an approved provider (Apollo/RocketReach) verifies the address.

## Authentication

- Sign in with platform credentials to get an access token (~15 min) and a rotating refresh token (~30 days).
- Expired access tokens are refreshed automatically. Refresh is single-flight, so concurrent calls share one rotation, and a 401 triggers exactly one retry.
- If the refresh token is rejected, the panel shows "session expired" and returns to sign-in. A network failure does not sign you out.
- Sign-out revokes the refresh token on the server and clears local storage even if the server can't be reached.
- **Tradeoff:** the refresh token is kept in `chrome.storage.local` so the session survives browser restarts. It is a revocable, rotating platform session token, not an integration credential. Third-party keys (OpenAI, Exa, Apollo, Gmail OAuth, etc.) stay on the server and never reach the extension. The API client only calls `/api/v1/*` and sends no cookies (`credentials: "omit"`).

## Layout

```
manifest.json            MV3 manifest (version taken from package.json at build)
build.mjs                esbuild bundling, PNG icon generation, --zip packaging
public/                  sidepanel.html, popup.html, sidepanel.css
src/background.ts        service worker: per-tab context, RPC, owns AuthManager + ApiClient
src/content/*.ts         LinkedIn company/person and Gmail parsers (pure, unit-tested)
src/lib/                 config, context routing, http, auth, api, errors, messages
src/sidepanel/           dom builder (textContent only), views, wiring
test/                    vitest suites + synthetic fixtures (no real people)
```
