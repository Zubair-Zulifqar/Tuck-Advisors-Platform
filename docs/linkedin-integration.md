# LinkedIn integration

Tuck does **not** call LinkedIn APIs, scrape, or automate any LinkedIn account. Support is limited to:

1. **Extension context (read-only).** On `linkedin.com/company/*` and `linkedin.com/in/*`, content scripts read what is already
   rendered for the signed-in user (name, tagline/headline, industry, HQ/location, website, size, current company). The user
   reviews and edits the fields before creating a CRM record; duplicates (domain, LinkedIn URL, normalised name) are flagged.
2. **Manual verification workflow.** A person confirms that a LinkedIn page matches the CRM record:
   `POST /api/v1/linkedin/verify {entity: company|contact, id, status: manually_verified|mismatch|unverified, linkedinUrl?}`
   — sets `linkedin_verification` and writes a timeline activity naming the verifier. Available in the hub and extension.
3. **Connection status / outreach.** Connection requests and messages are always performed by the human in LinkedIn. The
   platform tracks only what users record (activities/tasks); no approved partner API is integrated.

If an approved LinkedIn partner integration becomes available, it would be added as a new adapter in
`packages/integrations` behind the same verification fields.
