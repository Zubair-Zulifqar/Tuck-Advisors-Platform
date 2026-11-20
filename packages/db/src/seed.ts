import { DEFAULT_MATRIX } from "@tuck/shared";
import type { Db } from "./driver";
import { hashPassword } from "./passwords";

/**
 * Idempotent demo seed with entirely fictional companies and people (example.* domains).
 * Never run against production: guarded by NODE_ENV and an explicit flag.
 */
export async function seed(db: Db, opts: { password: string; force?: boolean }) {
  if (process.env.NODE_ENV === "production" && !opts.force) throw new Error("Refusing to seed in production");
  const existing = await db.query<{ id: string }>("select id from public.organizations where slug = 'tuck-advisors'");
  if (existing.rows[0]) return { organizationId: existing.rows[0].id, created: false };

  const hash = await hashPassword(opts.password);
  return db.transaction(async (tx) => {
    const org = (await tx.query<{ id: string }>("insert into public.organizations (name, slug) values ('Tuck Advisors', 'tuck-advisors') returning id")).rows[0]!.id;
    const users: Record<string, string> = {};
    for (const [key, email, name, role] of [
      ["owner", "owner@tuck.example", "Morgan Hale", "owner"],
      ["admin", "admin@tuck.example", "Jordan Pierce", "admin"],
      ["analyst", "analyst@tuck.example", "Riley Chen", "analyst"],
      ["viewer", "viewer@tuck.example", "Sam Ortiz", "viewer"],
    ] as const) {
      const id = (await tx.query<{ id: string }>("insert into public.users (email, name, password_hash) values ($1,$2,$3) returning id", [email, name, hash])).rows[0]!.id;
      users[key] = id;
      await tx.query("insert into public.memberships (organization_id, user_id, role) values ($1,$2,$3)", [org, id, role]);
    }
    await tx.query("select set_config('app.user_id', $1, true)", [users.owner]);

    const companies: Record<string, string> = {};
    const rows: [string, string, string, string, string, string, string[], Record<string, unknown>][] = [
      ["northwind", "Northwind Clinical Software", "northwind-clinical.example", "Healthcare Software", "target", "Austin, TX", ["saas", "healthcare"], { business_model: "Subscription software (SaaS)", products: "patient scheduling, intake forms", customer_segments: "Independent clinics", geographies: "United States" }],
      ["harbor", "Harbor Health Systems", "harborhealth.example", "Healthcare Software", "buyer", "Boston, MA", ["strategic", "healthcare"], { business_model: "Subscription software (SaaS)", products: "EHR, revenue cycle management, patient portal", customer_segments: "Hospitals, Independent clinics", geographies: "United States, Canada", strategic_themes: "platform consolidation" }],
      ["copperline", "Copperline HVAC Services", "copperline-hvac.example", "Construction & Trades", "target", "Columbus, OH", ["services", "recurring-revenue"], { business_model: "Managed / professional services", products: "commercial HVAC maintenance contracts", customer_segments: "Commercial property managers", geographies: "Ohio, Indiana" }],
      ["summit", "Summit Facility Partners", "summitfp.example", "Construction & Trades", "buyer", "Chicago, IL", ["pe-backed", "roll-up"], { business_model: "Managed / professional services", products: "facility maintenance, HVAC, electrical", customer_segments: "Commercial property managers", geographies: "Midwest" }],
      ["ledgerly", "Ledgerly", "ledgerly.example", "Financial Services", "prospect", "Denver, CO", ["fintech"], {}],
      ["brightpath", "BrightPath Learning", "brightpath-learning.example", "Education", "client", "Raleigh, NC", ["edtech"], {}],
    ];
    for (const [key, name, domain, industry, kind, hq, tags, cf] of rows) {
      companies[key] = (
        await tx.query<{ id: string }>(
          `insert into public.companies (organization_id, name, normalized_name, domain, website, industry, kind, headquarters, employee_range, tags, custom_fields, description, created_by)
           values ($1,$2,lower(regexp_replace($2,'[^a-zA-Z0-9]+',' ','g')),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [org, name, domain, `https://${domain}`, industry, kind, hq, kind === "buyer" ? "501-1000" : "51-200", tags, JSON.stringify(cf), `${name} — fictional demo company for local development.`, users.owner],
        )
      ).rows[0]!.id;
    }
    await tx.query("insert into public.buyers (organization_id, company_id, buyer_type) values ($1,$2,'strategic'), ($1,$3,'financial')", [org, companies.harbor, companies.summit]);
    await tx.query("insert into public.acquisition_targets (organization_id, company_id, status, thesis) values ($1,$2,'researching','Vertical SaaS tuck-in for healthcare platforms'), ($1,$3,'identified','Recurring maintenance revenue; founder nearing retirement')", [org, companies.northwind, companies.copperline]);

    const contacts: [string, string, string, string, string, string][] = [
      ["Avery", "Lane", "avery.lane@northwind-clinical.example", "CEO & Founder", "northwind", "manually_verified"],
      ["Casey", "Morgan", "casey@harborhealth.example", "VP Corporate Development", "harbor", "manually_verified"],
      ["Drew", "Patel", "drew.patel@copperline-hvac.example", "Owner", "copperline", "unverified"],
      ["Emerson", "Blake", "emerson@summitfp.example", "Managing Partner", "summit", "manually_verified"],
    ];
    const contactIds: string[] = [];
    for (const [f, l, e, t, co, st] of contacts)
      contactIds.push((await tx.query<{ id: string }>("insert into public.contacts (organization_id, company_id, first_name, last_name, email, email_status, title, tags, created_by) values ($1,$2,$3,$4,$5,$6,$7,'{demo}',$8) returning id", [org, companies[co], f, l, e, st, t, users.owner])).rows[0]!.id);

    await tx.query(
      `insert into public.deals (organization_id, name, target_company_id, buyer_company_id, side, stage, estimated_value_usd, owner_user_id) values
       ($1,'Project Beacon',$2,$3,'sell_side','nda',null,$6), ($1,'Project Copper',$4,$5,'sell_side','engaged',null,$7), ($1,'Harbor add-on search',null,$3,'buy_side','qualified',null,$6)`,
      [org, companies.northwind, companies.harbor, companies.copperline, companies.summit, users.owner, users.analyst],
    );
    await tx.query(
      `insert into public.tasks (organization_id, title, due_at, company_id, contact_id, assignee_user_id, created_by) values
       ($1,'Send NDA follow-up to Avery', now() + interval '1 day', $2, $4, $6, $6),
       ($1,'Prepare buyer list for Project Copper', now() + interval '3 days', $3, null, $7, $6),
       ($1,'Call Drew about succession timeline', now() - interval '1 day', $3, $5, $7, $6)`,
      [org, companies.northwind, companies.copperline, contactIds[0], contactIds[2], users.owner, users.analyst],
    );
    await tx.query(
      `insert into public.activities (organization_id, type, subject, body, company_id, contact_id, actor_user_id, occurred_at) values
       ($1,'call','Intro call with Avery','Discussed growth plans and openness to strategic partners.',$2,$4,$6, now() - interval '6 days'),
       ($1,'email','Sent teaser to Harbor corp dev',null,$3,$5,$6, now() - interval '3 days'),
       ($1,'note','Harbor interested in clinic scheduling capability',null,$3,null,$6, now() - interval '2 days')`,
      [org, companies.northwind, companies.harbor, contactIds[0], contactIds[1], users.owner],
    );
    await tx.query("insert into public.matrix_models (organization_id, key, version, name, definition, is_active, created_by) values ($1,$2,1,$3,$4,true,$5)", [org, DEFAULT_MATRIX.key, DEFAULT_MATRIX.name, JSON.stringify(DEFAULT_MATRIX), users.owner]);
    await tx.query(
      `insert into public.buyer_bucket_rules (organization_id, bucket, priority, rule, description) values
       ($1,'Healthcare Platform',10,$2,'Healthcare buyers with 500+ employees'),
       ($1,'Services Roll-up',20,$3,'PE-backed services consolidators'),
       ($1,'Opportunistic Strategic',100,$4,'Everything else with a known industry')`,
      [
        org,
        JSON.stringify([{ field: "industry", operator: "contains", values: ["health"] }, { field: "employeeCount", operator: "gte", values: [500] }]),
        JSON.stringify([{ field: "tags", operator: "contains", values: ["roll-up"] }]),
        JSON.stringify([{ field: "industry", operator: "not_in", values: [""] }]),
      ],
    );
    await tx.query("insert into public.communication_templates (organization_id, name, subject, body) values ($1,'Intro — sell-side','Introduction from Tuck Advisors','Hi {{first_name}},\n\nI lead sell-side work at Tuck Advisors focused on {{company.industry}}. {{personalized_opener}}\n\nWould you be open to a confidential 20-minute conversation?\n\nBest,\n{{sender_name}}')", [org]);
    await tx.query("insert into public.newsletter_subscribers (organization_id, email, name, status, consent_at) values ($1,'reader@subscriber.example','Demo Reader','subscribed',now())", [org]);
    return { organizationId: org, created: true, users };
  });
}
