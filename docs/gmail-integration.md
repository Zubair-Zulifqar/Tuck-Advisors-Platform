# Gmail integration

Two independent paths, both minimal-scope and human-initiated.

## 1. Extension side panel (implemented)
- Runs only on `mail.google.com`. Parses the **open conversation only**: subject, participant addresses (`[email]` attributes)
  and thread id. Message bodies, the inbox list and other threads are never read.
- Matches participants against the CRM (`GET /api/v1/match?emails=…`, own address excluded; free-mail domains are ignored for
  company matching), shows associated companies and colour-coded deal stages.
- "Create contact" for unknown senders (saved `unverified`), and "Log this thread to CRM" → `POST /api/v1/activities`
  with `type: email`, subject, participants and `externalRef: gmail:<threadId>`; repeat logging is a no-op.
- Nothing is sent from Gmail; the extension cannot send email.

## 2. Gmail API (server-side client, consent flow pending)
`packages/integrations/src/google.ts` provides:
- `GoogleOAuth` — authorization URL (incremental scopes, offline access), code exchange, refresh.
- `GmailClient.getThreadMetadata` (`format=metadata`, headers only), `findReplies` (reply detection), `createDraft`
  (creates a draft for a human to send — never sends).
- `GoogleDocsClient.createDocument` (scope `drive.file`) used by report export on explicit click.

Scopes: `gmail.readonly`, `gmail.compose`, `drive.file` — requested only for the features a user enables.

**Status:** OAuth routes/UI to obtain and store per-user Google tokens are not yet wired; Docs export accepts a user-supplied
access token, and outreach reply detection currently arrives via the signed inbound webhook
(`POST /api/webhooks/inbound`, `type: "outreach.reply"`), e.g. from a Google Apps Script running in the sender's own mailbox.
