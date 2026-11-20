import { createPgDb, migrate } from "@tuck/db";
import { createEngineDeps } from "@tuck/engine";
import { runAllQueues, runRetention } from "./queues";

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
const once = process.argv.includes("--once");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the standalone worker (local dev runs jobs inside the web process).");
  const db = await createPgDb(process.env.DATABASE_URL);
  if (process.env.AUTO_MIGRATE === "true") await migrate(db);
  const deps = createEngineDeps(db, process.env);
  let stopping = false;
  let lastRetention = 0;
  const shutdown = () => {
    stopping = true;
    deps.logger.info("worker.stopping");
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  deps.logger.info("worker.started", { intervalMs, llm: deps.llm.name, research: deps.research.name, email: deps.email.name });
  do {
    const started = Date.now();
    try {
      const r = await runAllQueues(deps);
      if (Object.values(r).some((v) => v > 0)) deps.logger.info("worker.tick", r);
      if (Date.now() - lastRetention > 24 * 3600_000) {
        lastRetention = Date.now();
        deps.logger.info("worker.retention", { result: await runRetention(deps) });
      }
    } catch (e) {
      deps.logger.error("worker.tick_failed", { error: (e as Error).message });
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - started))));
  } while (!stopping);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
