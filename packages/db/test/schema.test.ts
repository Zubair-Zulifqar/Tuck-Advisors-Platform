import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, withOrg, asSystem, type Db } from "../src";
import { createCompany, listCompanies, getCompany, updateCompany } from "../src/repos/companies";
import { createContact, applyEnrichment } from "../src/repos/contacts";
import { changeDealStage, createDeal, listActivities } from "../src/repos/pipeline";

let db: Db;
const ids = {
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  alice: "00000000-0000-4000-8000-0000000000a1",
  bob: "00000000-0000-4000-8000-0000000000b1",
  viewer: "00000000-0000-4000-8000-0000000000a2",
};

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  await db.exec(`
    insert into organizations(id, name, slug) values ('${ids.orgA}', 'Org A', 'org-a'), ('${ids.orgB}', 'Org B', 'org-b');
    insert into users(id, email, name) values ('${ids.alice}', 'alice@a.test', 'Alice'), ('${ids.bob}', 'bob@b.test', 'Bob'), ('${ids.viewer}', 'v@a.test', 'Vee');
    insert into memberships(organization_id, user_id, role) values ('${ids.orgA}', '${ids.alice}', 'owner'), ('${ids.orgB}', '${ids.bob}', 'owner'), ('${ids.orgA}', '${ids.viewer}', 'viewer');
  `);
}, 60_000);
afterAll(() => db.close());

const alice = { userId: ids.alice, organizationId: ids.orgA, role: "owner" as const };
const bob = { userId: ids.bob, organizationId: ids.orgB, role: "owner" as const };

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("companies + RLS", () => {
  it("creates companies and blocks duplicates by domain", async () => {
    const c = await withOrg(db, alice, (tx) =>
      createCompany(tx, ids.orgA, ids.alice, { name: "Acme Inc.", website: "https://www.acme.com", kind: "target", tags: ["saas"], customFields: {} }),
    );
    expect(c.domain).toBe("acme.com");
    await expect(
      withOrg(db, alice, (tx) => createCompany(tx, ids.orgA, ids.alice, { name: "Acme Two", domain: "acme.com", kind: "prospect", tags: [], customFields: {} })),
    ).rejects.toThrow(/already exists/);
  });

  it("isolates organisations at the database level even if the app forgets a filter", async () => {
    // Bob queries org A's id directly — RLS must hide the rows.
    const leaked = await withOrg(db, bob, (tx) => tx.query("select * from public.companies"));
    expect(leaked.rows).toHaveLength(0);
    const list = await withOrg(db, bob, (tx) => listCompanies(tx, ids.orgA));
    expect(list.items).toHaveLength(0);
  });

  it("prevents cross-org inserts", async () => {
    await expect(
      withOrg(db, bob, (tx) => createCompany(tx, ids.orgA, ids.bob, { name: "Evil", kind: "prospect", tags: [], customFields: {} })),
    ).rejects.toThrow();
  });

  it("prevents viewers from writing", async () => {
    const viewer = { userId: ids.viewer, organizationId: ids.orgA, role: "viewer" as const };
    await expect(
      withOrg(db, viewer, (tx) => createCompany(tx, ids.orgA, ids.viewer, { name: "Nope", kind: "prospect", tags: [], customFields: {} })),
    ).rejects.toThrow();
    const list = await withOrg(db, viewer, (tx) => listCompanies(tx, ids.orgA));
    expect(list.items.length).toBeGreaterThan(0);
  });

  it("writes an audit trail with the acting user and field diffs", async () => {
    const { items } = await withOrg(db, alice, (tx) => listCompanies(tx, ids.orgA, { q: "acme" }));
    await withOrg(db, alice, (tx) => updateCompany(tx, ids.orgA, items[0]!.id, { industry: "Software" }));
    const { rows } = await asSystem(db, (tx) =>
      tx.query<{ action: string; actor_user_id: string; changes: Record<string, unknown> }>(
        "select * from audit_logs where table_name = 'companies' and action = 'update' order by id desc limit 1",
      ),
    );
    expect(rows[0]?.actor_user_id).toBe(ids.alice);
    expect(rows[0]?.changes).toHaveProperty("industry");
  });
});

describe("contacts and deals", () => {
  it("never lets callers self-declare provider verification", async () => {
    const c = await withOrg(db, alice, (tx) =>
      createContact(tx, ids.orgA, ids.alice, { firstName: "Jane", email: "jane@acme.com", emailStatus: "provider_verified", tags: [], source: "manual" }),
    );
    expect(c.email_status).toBe("unverified");
    const enriched = await withOrg(db, alice, (tx) =>
      applyEnrichment(tx, ids.orgA, c.id, { email: "jane@acme.com", emailVerified: true, provider: "apollo", title: "CEO" }),
    );
    expect(enriched.email_status).toBe("provider_verified");
    expect(enriched.title).toBe("CEO");
  });

  it("logs stage changes to the activity timeline", async () => {
    const result = await withOrg(db, alice, async (tx) => {
      const co = await getCompany(tx, ids.orgA, (await listCompanies(tx, ids.orgA)).items[0]!.id);
      const deal = await createDeal(tx, ids.orgA, ids.alice, { name: "Project Falcon", targetCompanyId: co.id, side: "sell_side", stage: "sourced" });
      const changed = await changeDealStage(tx, ids.orgA, ids.alice, deal.id, "nda");
      const acts = await listActivities(tx, ids.orgA, { dealId: deal.id });
      return { changed, acts };
    });
    expect(result.changed.from).toBe("sourced");
    expect(result.acts[0]?.type).toBe("stage_change");
  });

  it("rejects linking a deal to another org's company", async () => {
    const orgACompany = (await withOrg(db, alice, (tx) => listCompanies(tx, ids.orgA))).items[0]!;
    await expect(
      withOrg(db, bob, (tx) => createDeal(tx, ids.orgB, ids.bob, { name: "Steal", targetCompanyId: orgACompany.id, side: "buy_side", stage: "sourced" })),
    ).rejects.toThrow(/not found/);
  });
});
