import { describe, expect, it } from "vitest";
import { asSystem, createPgliteDb, migrate } from "@tuck/db";
import { createEngineDeps } from "@tuck/engine";
import { MockEmailProvider, MockLlmProvider, silentLogger } from "@tuck/integrations";
import { runAllQueues, runRetention } from "../src/queues";

describe("worker queues", () => {
  it("fires follow-up events exactly once and runs retention", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const org = "00000000-0000-4000-8000-0000000000cc";
    await db.exec(`insert into organizations(id,name,slug) values ('${org}','Worker Org','worker-org');
      insert into automations(organization_id,name,trigger_type,definition) values ('${org}','fu','task.follow_up_due',
        '{"name":"fu","trigger":{"type":"task.follow_up_due","config":{}},"actions":[{"id":"n","type":"notify.member","params":{"message":"due: {{payload.title}}"}}]}');
      insert into tasks(organization_id,title,due_at) values ('${org}','Call owner', now() - interval '1 hour');
      insert into ai_analyses(organization_id,target_url,buyer_url,report,consent_at,expires_at) values ('${org}','https://a.example','https://b.example','{}',now(),now() - interval '1 day');`);
    const deps = createEngineDeps(db, {}, { logger: silentLogger, llm: new MockLlmProvider(), email: new MockEmailProvider() });
    const first = await runAllQueues(deps);
    const second = await runAllQueues(deps);
    expect(first.followUps).toBe(1);
    expect(second.followUps).toBe(0);
    const acts = await asSystem(db, (tx) => tx.query<{ subject: string }>("select subject from activities where organization_id = $1", [org]));
    expect(acts.rows.map((r) => r.subject)).toContain("due: Call owner");
    expect(await runRetention(deps)).toMatchObject({ ai_analyses: 1 });
    await db.close();
  }, 60_000);
});
