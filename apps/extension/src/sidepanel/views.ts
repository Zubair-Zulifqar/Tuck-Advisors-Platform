import type { FitScoreResult, PageContext } from "@tuck/shared";
import type { AuthStatus, User } from "../lib/auth";
import { ApiError, AuthError, NetworkError } from "../lib/errors";
import { badge, busy, button, card, emailBadge, field, h, input, link, mount, stageChip, statusLine } from "./dom";

// ------------------------------------------------------------------ types
export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  website?: string | null;
  industry: string | null;
  kind: string;
  headquarters?: string | null;
  linkedin_url?: string | null;
  linkedin_verification?: string;
}
export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  email_status: string;
  title: string | null;
  company_id: string | null;
  company_name?: string | null;
  linkedin_url?: string | null;
  linkedin_verification?: string;
}
export interface DealRow {
  id: string;
  name: string;
  stage: string;
  target_company_id: string | null;
  buyer_company_id: string | null;
}
export interface MatchResult {
  companies: CompanyRow[];
  contacts: ContactRow[];
  deals: DealRow[];
}
interface Job {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  last_error?: string | null;
  report?: { id: string; title: string; content: unknown; sources?: { id: string; url: string; title?: string }[] } | null;
}

export interface PanelDeps {
  baseUrl: string;
  user: User | null;
  api: { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T> };
  login(baseUrl: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshContext(): Promise<void>;
  onAuthLost(): void;
  pollIntervalMs?: number;
}

export const TOOLKIT: { kind: string; label: string; needs: "company" | "contact" | "either" }[] = [
  { kind: "business_overview", label: "Business overview", needs: "company" },
  { kind: "positioning_statement", label: "Positioning statement", needs: "company" },
  { kind: "capital_raise", label: "Capital raise signals", needs: "company" },
  { kind: "acquisition_analysis", label: "Acquisition analysis", needs: "company" },
  { kind: "similar_companies", label: "Similar companies", needs: "company" },
  { kind: "buyer_classification", label: "Buyer classification", needs: "company" },
  { kind: "pre_call_notes", label: "Pre-call notes", needs: "either" },
  { kind: "post_call_notes", label: "Post-call notes", needs: "either" },
];

// ------------------------------------------------------------------ helpers
export function describeError(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  if (e instanceof NetworkError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 403) return "Your role does not allow this action.";
    if (e.status === 422) return `Please check the form: ${e.message}`;
    if (e.status === 429) return "Too many requests — please wait a moment and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

function handleError(deps: PanelDeps, status: ReturnType<typeof statusLine>, e: unknown) {
  status.set("error", describeError(e));
  if (e instanceof AuthError) deps.onAuthLost();
}

function crmUrl(deps: PanelDeps, entity: "companies" | "contacts" | "deals", id: string) {
  return `${deps.baseUrl}/app/${entity}/${id}`;
}

function withScheme(url: string | undefined) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function domainOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(withScheme(url)).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function qs(params: Record<string, string | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  return u.toString();
}

function header(title: string, subtitle?: string, extra?: Node) {
  return h("header", { class: "view-header" }, h("div", {}, h("h2", {}, title), subtitle ? h("p", { class: "muted" }, subtitle) : null), extra ?? null);
}

function dealsList(deals: DealRow[], deps: PanelDeps) {
  if (!deals.length) return h("p", { class: "muted small" }, "No deals linked yet.");
  return h(
    "ul",
    { class: "deal-list" },
    deals.map((d) => h("li", {}, stageChip(d.stage), " ", link(crmUrl(deps, "deals", d.id), d.name))),
  );
}

function duplicateNotice(e: ApiError, deps: PanelDeps, entity: "companies" | "contacts") {
  return h(
    "div",
    { class: "notice notice-warn" },
    h("strong", {}, "Possible duplicate — not created."),
    h(
      "ul",
      {},
      e.duplicates.map((d) =>
        h("li", {}, link(crmUrl(deps, entity, d.id), d.name), d.reason ? h("span", { class: "muted small" }, ` (matched on ${d.reason})`) : null),
      ),
    ),
  );
}

/** Renders structured report content generically: claims show provenance, nested objects become lists. */
export function renderValue(v: unknown, depth = 0): Node {
  if (depth > 4) return document.createTextNode("…");
  if (v === null || v === undefined) return h("span", { class: "muted" }, "Unknown");
  if (typeof v !== "object") return document.createTextNode(String(v));
  if (Array.isArray(v)) return h("ul", { class: "report-list" }, v.slice(0, 30).map((x) => h("li", {}, renderValue(x, depth + 1))));
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string" && typeof o.provenance === "string") {
    const tone = o.provenance === "sourced" ? "ok" : o.provenance === "unknown" ? "muted" : "info";
    const label = o.provenance === "sourced" ? "Sourced" : o.provenance === "unknown" ? "Unknown" : "AI assessment";
    return h("span", {}, badge(label, tone), " ", o.text);
  }
  return h(
    "dl",
    { class: "report-dl" },
    Object.entries(o)
      .slice(0, 40)
      .flatMap(([k, val]) => [h("dt", {}, k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")), h("dd", {}, renderValue(val, depth + 1))]),
  );
}

/** Queues a research job and polls until it finishes, rendering progress into `out`. */
export async function runResearch(deps: PanelDeps, out: HTMLElement, body: { kind: string; companyId?: string; contactId?: string; input?: unknown }) {
  const status = statusLine();
  mount(out, status.el);
  status.set("loading", "Queuing research job…");
  try {
    let job = await deps.api.post<Job>("/api/v1/research", body);
    const interval = deps.pollIntervalMs ?? 2000;
    const deadline = Date.now() + 3 * 60_000;
    while ((job.status === "queued" || job.status === "running") && Date.now() < deadline) {
      status.set("loading", job.status === "queued" ? "Waiting for a research worker…" : "Researching…");
      await new Promise((r) => setTimeout(r, interval));
      job = await deps.api.get<Job>(`/api/v1/research/jobs/${encodeURIComponent(job.id)}`);
    }
    if (job.status === "succeeded" && job.report) {
      status.set("ok", "Research complete. Review before relying on it — AI assessments are not verified facts.");
      out.append(
        card(
          job.report.title,
          renderValue(job.report.content),
          job.report.sources?.length
            ? h("details", { class: "sources" }, h("summary", {}, `Sources (${job.report.sources.length})`), h("ul", {}, job.report.sources.map((s) => h("li", {}, link(s.url, s.title || s.url)))))
            : h("p", { class: "muted small" }, "No external sources were retrieved."),
        ),
      );
    } else if (job.status === "succeeded") {
      status.set("ok", "Job finished.");
    } else if (job.status === "queued" || job.status === "running") {
      status.set("idle", "Still running — results will appear in the Tuck platform.");
    } else {
      status.set("error", `Research ${job.status}: ${job.last_error ?? "no details"}`);
    }
  } catch (e) {
    handleError(deps, status, e);
  }
}

// ------------------------------------------------------------------ login
export function renderLogin(root: HTMLElement, auth: AuthStatus, deps: PanelDeps) {
  const status = statusLine();
  const base = input("baseUrl", auth.baseUrl, { type: "url", required: true, placeholder: "https://app.tuckadvisors.com" });
  const email = input("email", "", { type: "email", required: true, autocomplete: "username" });
  const pw = input("password", "", { type: "password", required: true, autocomplete: "current-password" });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Sign in");
  const form = h(
    "form",
    { class: "stack", novalidate: true },
    field("Platform URL", base, "Your Tuck Advisors workspace. HTTPS required except for localhost."),
    field("Work email", email),
    field("Password", pw),
    submit,
    status.el,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!email.value || !pw.value) return status.set("error", "Enter your email and password.");
    await busy(submit, "Signing in…", async () => {
      status.set("loading", "Connecting…");
      try {
        await deps.login(base.value, email.value.trim(), pw.value);
        pw.value = "";
        status.set("ok", "Signed in.");
      } catch (e) {
        status.set("error", describeError(e));
      }
    });
  });
  if (auth.state === "expired") status.set("error", "Your session expired. Please sign in again.");
  mount(
    root,
    header("Connect to Tuck Advisors", "Sign in with your platform account. Integration keys never leave the server."),
    h("div", { class: "connection" }, h("span", { class: `dot dot-${auth.state === "signed_in" ? "ok" : "off"}` }), auth.state === "expired" ? "Session expired" : "Not connected"),
    form,
  );
}

// ------------------------------------------------------------------ LinkedIn company
export async function renderLinkedinCompany(root: HTMLElement, ctx: Extract<PageContext, { kind: "linkedin_company" }>, deps: PanelDeps) {
  const status = statusLine();
  const body = h("div", { class: "stack" });
  mount(root, header(ctx.name ?? ctx.slug, "LinkedIn company page", badge("LinkedIn", "info")), status.el, body);
  status.set("loading", "Checking the CRM…");
  let match: MatchResult;
  try {
    match = await deps.api.get<MatchResult>(`/api/v1/match?${qs({ linkedinUrl: ctx.url, name: ctx.name, domain: domainOf(ctx.website) })}`);
  } catch (e) {
    return handleError(deps, status, e);
  }
  const existing = match.companies[0];
  if (existing) {
    status.set("ok", "This company is already in your CRM.");
    body.append(companyCard(existing, match.deals.filter((d) => d.target_company_id === existing.id || d.buyer_company_id === existing.id), deps));
    return;
  }
  status.set("idle", "Not in the CRM yet. Review the details below — only what is visible on this page was captured.");
  body.append(companyForm(ctx, deps, root));
}

function companyCard(c: CompanyRow, deals: DealRow[], deps: PanelDeps) {
  const status = statusLine();
  const out = h("div", {});
  const verified = c.linkedin_verification === "manually_verified";
  const verifyBtn = button(verified ? "LinkedIn verified" : "Mark LinkedIn verified", async () => {
    await busy(verifyBtn, "Saving…", async () => {
      try {
        await deps.api.post("/api/v1/linkedin/verify", { entity: "company", id: c.id, status: "manually_verified" });
        verifyBtn.textContent = "LinkedIn verified";
        status.set("ok", "Marked as manually verified.");
      } catch (e) {
        handleError(deps, status, e);
      }
    });
  }, "secondary", { disabled: verified });
  return card(
    c.name,
    h(
      "dl",
      { class: "kv" },
      h("dt", {}, "Domain"),
      h("dd", {}, c.domain ?? "—"),
      h("dt", {}, "Industry"),
      h("dd", {}, c.industry ?? "—"),
      h("dt", {}, "Type"),
      h("dd", {}, c.kind),
      h("dt", {}, "LinkedIn"),
      h("dd", {}, verified ? badge("Manually verified", "ok") : badge("Unverified", "warn")),
    ),
    h("h4", {}, "Deals"),
    dealsList(deals, deps),
    h(
      "div",
      { class: "row" },
      link(crmUrl(deps, "companies", c.id), "Open in Tuck"),
      verifyBtn,
      button("Business overview", () => void runResearch(deps, out, { kind: "business_overview", companyId: c.id }), "ghost"),
    ),
    status.el,
    out,
  );
}

function companyForm(ctx: Extract<PageContext, { kind: "linkedin_company" }>, deps: PanelDeps, root: HTMLElement) {
  const status = statusLine();
  const f = {
    name: input("name", ctx.name ?? "", { required: true, maxlength: 200 }),
    website: input("website", ctx.website ?? "", { type: "url", placeholder: "https://…" }),
    industry: input("industry", ctx.industry ?? ""),
    headquarters: input("headquarters", ctx.headquarters ?? ""),
    employeeRange: input("employeeRange", ctx.employeeRange ?? ""),
    description: h("textarea", { name: "description", rows: 3, maxlength: 5000 }, ctx.tagline ?? ""),
    kind: h("select", { name: "kind" }, ["prospect", "target", "buyer", "client", "other"].map((k) => h("option", { value: k }, k))),
  };
  const research = h("input", { type: "checkbox", name: "research" });
  const dup = h("div", {});
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Create company in CRM");
  const form = h(
    "form",
    { class: "stack" },
    field("Company name", f.name),
    field("Website", f.website),
    field("Industry", f.industry),
    field("Headquarters", f.headquarters),
    field("Employees", f.employeeRange),
    field("Description", f.description),
    field("Record type", f.kind),
    h("label", { class: "check" }, research, " Run a business-overview research job after creating"),
    dup,
    submit,
    status.el,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    dup.replaceChildren();
    if (!f.name.value.trim()) return status.set("error", "Company name is required.");
    await busy(submit, "Creating…", async () => {
      try {
        const company = await deps.api.post<CompanyRow>("/api/v1/companies", {
          name: f.name.value.trim(),
          website: withScheme(f.website.value.trim()) || undefined,
          linkedinUrl: ctx.url,
          industry: f.industry.value.trim() || undefined,
          headquarters: f.headquarters.value.trim() || undefined,
          employeeRange: f.employeeRange.value.trim() || undefined,
          description: f.description.value.trim() || undefined,
          kind: f.kind.value,
          tags: [],
          customFields: {},
        });
        const out = h("div", {});
        mount(root, header(company.name, "Created in your CRM"), h("p", { class: "status status-ok" }, "Company created."), companyCard(company, [], deps), out);
        if (research.checked) void runResearch(deps, out, { kind: "business_overview", companyId: company.id });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          dup.replaceChildren(duplicateNotice(e, deps, "companies"));
          status.set("error", "A matching company already exists.");
        } else handleError(deps, status, e);
      }
    });
  });
  return card("Add to CRM", form);
}

// ------------------------------------------------------------------ LinkedIn person
export async function renderLinkedinPerson(root: HTMLElement, ctx: Extract<PageContext, { kind: "linkedin_person" }>, deps: PanelDeps) {
  const status = statusLine();
  const body = h("div", { class: "stack" });
  mount(root, header(ctx.name ?? ctx.slug, ctx.headline ?? "LinkedIn profile", badge("LinkedIn", "info")), status.el, body);
  status.set("loading", "Checking the CRM…");
  let match: MatchResult;
  let companyMatch: MatchResult = { companies: [], contacts: [], deals: [] };
  try {
    [match, companyMatch] = await Promise.all([
      deps.api.get<MatchResult>(`/api/v1/match?${qs({ linkedinUrl: ctx.url })}`),
      ctx.currentCompany ? deps.api.get<MatchResult>(`/api/v1/match?${qs({ name: ctx.currentCompany })}`) : Promise.resolve(companyMatch),
    ]);
  } catch (e) {
    return handleError(deps, status, e);
  }
  body.append(
    h("p", { class: "notice notice-info small" }, "Outreach and connection requests are always performed by you, from your own account. The extension never sends messages or invitations."),
  );
  const existing = match.contacts[0];
  if (existing) {
    status.set("ok", "This person is already in your CRM.");
    body.append(contactCard(existing, match.deals, deps));
    return;
  }
  status.set("idle", "Not in the CRM yet.");
  body.append(contactForm(ctx, companyMatch.companies, deps, root));
}

export function contactCard(c: ContactRow, deals: DealRow[], deps: PanelDeps) {
  const status = statusLine();
  let current = c;
  const emailRow = h("dd", {});
  const paint = () => emailRow.replaceChildren(current.email ?? "No email on record", " ", current.email ? emailBadge(current.email_status) : "");
  paint();
  const enrichBtn = button("Enrich contact", async () => {
    await busy(enrichBtn, "Enriching…", async () => {
      try {
        current = await deps.api.post<ContactRow>(`/api/v1/contacts/${encodeURIComponent(c.id)}/enrich`, {});
        paint();
        status.set(
          "ok",
          current.email_status === "provider_verified"
            ? "Enrichment complete — email verified by the provider."
            : "Enrichment complete. Any email found is unverified and must not be treated as confirmed.",
        );
      } catch (e) {
        handleError(deps, status, e);
      }
    });
  }, "secondary");
  const verified = c.linkedin_verification === "manually_verified";
  const verifyBtn = button(verified ? "LinkedIn verified" : "Mark LinkedIn verified", async () => {
    await busy(verifyBtn, "Saving…", async () => {
      try {
        await deps.api.post("/api/v1/linkedin/verify", { entity: "contact", id: c.id, status: "manually_verified" });
        verifyBtn.textContent = "LinkedIn verified";
        verifyBtn.disabled = true;
        status.set("ok", "Marked as manually verified.");
      } catch (e) {
        handleError(deps, status, e);
      }
    });
  }, "ghost", { disabled: verified });
  return card(
    `${c.first_name} ${c.last_name ?? ""}`.trim(),
    h(
      "dl",
      { class: "kv" },
      h("dt", {}, "Title"),
      h("dd", {}, c.title ?? "—"),
      h("dt", {}, "Company"),
      h("dd", {}, c.company_id ? link(crmUrl(deps, "companies", c.company_id), c.company_name ?? "View company") : "—"),
      h("dt", {}, "Email"),
      emailRow,
    ),
    h("h4", {}, "Deals"),
    dealsList(deals, deps),
    h("div", { class: "row" }, link(crmUrl(deps, "contacts", c.id), "Open in Tuck"), enrichBtn, verifyBtn),
    status.el,
  );
}

function splitName(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function contactForm(ctx: Extract<PageContext, { kind: "linkedin_person" }>, companies: CompanyRow[], deps: PanelDeps, root: HTMLElement) {
  const status = statusLine();
  const n = splitName(ctx.name);
  const first = input("firstName", n.first, { required: true });
  const last = input("lastName", n.last);
  const title = input("title", ctx.headline ?? "");
  const email = input("email", "", { type: "email", placeholder: "Optional — saved as unverified" });
  const company = h(
    "select",
    { name: "companyId" },
    h("option", { value: "" }, companies.length ? "— No company —" : "No matching company in CRM"),
    companies.map((c, i) => h("option", { value: c.id, selected: i === 0 }, `${c.name}${c.domain ? ` (${c.domain})` : ""}`)),
  );
  const dup = h("div", {});
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Create contact in CRM");
  const form = h(
    "form",
    { class: "stack" },
    field("First name", first),
    field("Last name", last),
    field("Title / headline", title),
    field("Company", company, ctx.currentCompany ? `Shown on profile: ${ctx.currentCompany}` : undefined),
    field("Email", email, "Manually entered emails are stored as unverified until an approved provider verifies them."),
    dup,
    submit,
    status.el,
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    dup.replaceChildren();
    if (!first.value.trim()) return status.set("error", "First name is required.");
    await busy(submit, "Creating…", async () => {
      try {
        const c = await deps.api.post<ContactRow>("/api/v1/contacts", {
          firstName: first.value.trim(),
          lastName: last.value.trim() || undefined,
          title: title.value.trim() || undefined,
          email: email.value.trim() || undefined,
          emailStatus: "unverified",
          linkedinUrl: ctx.url,
          companyId: company.value || undefined,
          source: "linkedin_extension",
          tags: [],
        });
        mount(root, header(`${c.first_name} ${c.last_name ?? ""}`.trim(), "Created in your CRM"), h("p", { class: "status status-ok" }, "Contact created."), contactCard(c, [], deps));
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          dup.replaceChildren(duplicateNotice(e, deps, "contacts"));
          status.set("error", "A matching contact already exists.");
        } else handleError(deps, status, e);
      }
    });
  });
  return card("Add to CRM", form);
}

// ------------------------------------------------------------------ Gmail
export async function renderGmail(root: HTMLElement, ctx: Extract<PageContext, { kind: "gmail_thread" }>, deps: PanelDeps) {
  const status = statusLine();
  const body = h("div", { class: "stack" });
  mount(root, header(ctx.subject ?? "Email thread", "Gmail — open conversation only", badge("Gmail", "info")), status.el, body);
  const me = deps.user?.email?.toLowerCase();
  const people = ctx.participants.filter((p) => p.email !== me);
  if (!ctx.participants.length) {
    status.set("idle", "Open a conversation to see CRM matches for its participants.");
    return;
  }
  status.set("loading", "Matching participants against the CRM…");
  let match: MatchResult;
  try {
    match = await deps.api.get<MatchResult>(`/api/v1/match?${qs({ emails: people.map((p) => p.email).join(",") })}`);
  } catch (e) {
    return handleError(deps, status, e);
  }
  status.set("ok", `${match.contacts.length} of ${people.length} participant(s) matched.`);
  const byEmail = new Map(match.contacts.map((c) => [c.email?.toLowerCase(), c]));

  body.append(
    card(
      "Participants",
      h(
        "ul",
        { class: "people" },
        people.map((p) => {
          const c = byEmail.get(p.email);
          if (c) {
            const deals = match.deals.filter((d) => c.company_id && (d.target_company_id === c.company_id || d.buyer_company_id === c.company_id));
            return h(
              "li",
              { class: "person matched" },
              h("div", {}, link(crmUrl(deps, "contacts", c.id), `${c.first_name} ${c.last_name ?? ""}`.trim()), " ", emailBadge(c.email_status)),
              h("div", { class: "muted small" }, p.email, c.company_name ? ` · ${c.company_name}` : ""),
              deals.length ? h("div", { class: "chips" }, deals.map((d) => stageChip(d.stage))) : null,
            );
          }
          const s = statusLine();
          const li = h("li", { class: "person" });
          const btn = button("Create contact", async () => {
            await busy(btn, "Creating…", async () => {
              try {
                const nm = splitName(p.name);
                const created = await deps.api.post<ContactRow>("/api/v1/contacts", {
                  firstName: nm.first || p.email.split("@")[0],
                  lastName: nm.last || undefined,
                  email: p.email,
                  emailStatus: "unverified",
                  source: "gmail_extension",
                  tags: [],
                });
                byEmail.set(p.email, created);
                match.contacts.push(created);
                li.replaceChildren(h("div", {}, link(crmUrl(deps, "contacts", created.id), `${created.first_name} ${created.last_name ?? ""}`.trim()), " ", emailBadge(created.email_status)));
              } catch (e) {
                if (e instanceof ApiError && e.status === 409) s.set("error", "Already in CRM under another record.");
                else handleError(deps, s, e);
              }
            });
          }, "secondary");
          li.append(h("div", {}, p.name ?? p.email, " ", badge("Not in CRM", "muted")), h("div", { class: "muted small" }, p.email), btn, s.el);
          return li;
        }),
      ),
    ),
  );

  const logStatus = statusLine();
  const logBtn = button("Log this thread to CRM", async () => {
    const primary = match.contacts[0] ?? [...byEmail.values()][0];
    if (!primary) return logStatus.set("error", "Create or match at least one participant first.");
    await busy(logBtn, "Logging…", async () => {
      try {
        const res = await deps.api.post<unknown>("/api/v1/activities", {
          type: "email",
          subject: ctx.subject ?? "(no subject)",
          contactId: primary.id,
          companyId: primary.company_id ?? undefined,
          externalRef: ctx.threadId ? `gmail:${ctx.threadId}` : undefined,
          metadata: { source: "gmail_extension", participants: ctx.participants.map((p) => p.email) },
        });
        logStatus.set("ok", res === null ? "This thread was already logged." : "Thread logged to the contact timeline.");
      } catch (e) {
        handleError(deps, logStatus, e);
      }
    });
  });
  body.append(
    card(
      "Log conversation",
      h(
        "p",
        { class: "small" },
        "Sends only the subject line, participant email addresses and a thread reference to your Tuck workspace. Message bodies and other emails are never read or sent.",
      ),
      logBtn,
      logStatus.el,
    ),
  );
}

// ------------------------------------------------------------------ Tuck CRM toolkit
export function renderCrm(root: HTMLElement, ctx: Extract<PageContext, { kind: "tuck_crm" }>, deps: PanelDeps) {
  const companyId = input("companyId", ctx.entity === "companies" ? ctx.entityId ?? "" : "", { placeholder: "Company ID" });
  const contactId = input("contactId", ctx.entity === "contacts" ? ctx.entityId ?? "" : "", { placeholder: "Contact ID" });
  const notes = h("textarea", { name: "notes", rows: 4, placeholder: "Paste meeting notes or a transcript (for post-call notes)" });
  const out = h("div", { class: "stack" });
  const status = statusLine();

  const tools = TOOLKIT.map((t) =>
    button(t.label, () => {
      const cid = companyId.value.trim() || undefined;
      const pid = contactId.value.trim() || undefined;
      if (t.needs === "company" && !cid) return status.set("error", `${t.label} needs a company ID.`);
      if (t.needs === "either" && !cid && !pid) return status.set("error", `${t.label} needs a company or contact ID.`);
      if (t.kind === "post_call_notes" && !(notes as HTMLTextAreaElement).value.trim()) return status.set("error", "Paste the meeting notes first.");
      status.set("idle");
      void runResearch(deps, out, {
        kind: t.kind,
        companyId: cid,
        contactId: pid,
        input: t.kind === "post_call_notes" ? { notes: (notes as HTMLTextAreaElement).value } : undefined,
      });
    }, "secondary"),
  );

  const enrichBtn = button("Enrich contact", async () => {
    const pid = contactId.value.trim();
    if (!pid) return status.set("error", "Enter a contact ID to enrich.");
    await busy(enrichBtn, "Enriching…", async () => {
      try {
        const c = await deps.api.post<ContactRow>(`/api/v1/contacts/${encodeURIComponent(pid)}/enrich`, {});
        out.replaceChildren(contactCard(c, [], deps));
      } catch (e) {
        handleError(deps, status, e);
      }
    });
  }, "secondary");

  const buyer = input("buyerCompanyId", "", { placeholder: "Buyer company ID" });
  const target = input("targetCompanyId", ctx.entity === "companies" ? ctx.entityId ?? "" : "", { placeholder: "Target company ID" });
  const fitBtn = button("Calculate AI Fit Score", async () => {
    if (!buyer.value.trim() || !target.value.trim()) return status.set("error", "Enter both buyer and target company IDs.");
    await busy(fitBtn, "Scoring…", async () => {
      try {
        const { score } = await deps.api.post<{ score: FitScoreResult }>("/api/v1/fit-scores", {
          buyerCompanyId: buyer.value.trim(),
          targetCompanyId: target.value.trim(),
        });
        out.replaceChildren(fitScoreCard(score));
      } catch (e) {
        handleError(deps, status, e);
      }
    });
  });

  mount(
    root,
    header("AI Deal Toolkit", "Tuck CRM", badge("CRM", "info")),
    card("Record", field("Company", companyId), field("Contact", contactId)),
    card("Research", h("div", { class: "grid-buttons" }, tools), field("Meeting notes", notes), enrichBtn),
    card("AI Fit Score", field("Buyer", buyer), field("Target", target), fitBtn),
    status.el,
    out,
  );
}

export function fitScoreCard(s: FitScoreResult) {
  const tone = s.grade === "strong" ? "ok" : s.grade === "moderate" ? "info" : s.grade === "weak" ? "warn" : "bad";
  return card(
    h("span", {}, "Fit score ", h("strong", {}, s.score === null ? "—" : String(Math.round(s.score))), " ", badge(s.grade.replace("_", " "), tone)),
    h("p", { class: "muted small" }, `Model ${s.modelKey} v${s.modelVersion} · confidence ${Math.round(s.confidence * 100)}% · data coverage ${Math.round(s.coverage * 100)}%`),
    h(
      "table",
      { class: "cells" },
      h("thead", {}, h("tr", {}, h("th", {}, "Criterion"), h("th", {}, "Weight"), h("th", {}, "Score"))),
      h(
        "tbody",
        {},
        s.cells.map((c) => h("tr", { title: c.rationale }, h("td", {}, c.label), h("td", {}, String(c.weight)), h("td", {}, c.missing || c.score === null ? "missing" : `${Math.round(c.score * 100)}%`))),
      ),
    ),
    s.exclusions.length ? h("div", { class: "notice notice-warn" }, s.exclusions.map((x) => h("p", {}, x.reason))) : null,
    h("ul", { class: "small" }, s.explanation.map((e) => h("li", {}, e))),
  );
}

// ------------------------------------------------------------------ unsupported
export function renderUnsupported(root: HTMLElement, ctx: { url: string }) {
  mount(
    root,
    header("No deal context on this page", hostOf(ctx.url)),
    card(
      "Supported pages",
      h(
        "ul",
        {},
        h("li", {}, "LinkedIn company pages — linkedin.com/company/…"),
        h("li", {}, "LinkedIn profiles — linkedin.com/in/…"),
        h("li", {}, "An open Gmail conversation"),
        h("li", {}, "Your Tuck Advisors workspace — AI Deal Toolkit"),
      ),
    ),
  );
}
