import "server-only";
import { resolve } from "node:path";
import { createPgDb, createPgliteDb, migrate, seed, type Db } from "@tuck/db";
import { createEngineDeps, type EngineDeps } from "@tuck/engine";
import { env } from "./env";
import { startInlineWorker } from "./worker";

declare global {
  // eslint-disable-next-line no-var
  var __tuck: { db: Promise<Db>; deps?: Promise<EngineDeps> } | undefined;
}

async function boot(): Promise<Db> {
  if (env.DATABASE_URL) {
    const db = await createPgDb(env.DATABASE_URL);
    if (env.AUTO_MIGRATE === "true") await migrate(db);
    return db;
  }
  if (env.NODE_ENV === "production" && env.ALLOW_EMBEDDED_DB !== "true") throw new Error("DATABASE_URL is required in production");
  // Local development: embedded PostgreSQL (PGlite). Migrations + demo seed run automatically.
  const dir = env.PGLITE_DIR ?? resolve(process.cwd(), "../../.data/pglite");
  const db = await createPgliteDb(env.NODE_ENV === "test" ? undefined : dir);
  await migrate(db);
  if (env.SEED_PASSWORD) await seed(db, { password: env.SEED_PASSWORD, force: process.env.ALLOW_DEMO_SEED === "true" });
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalThis.__tuck) {
    const db = boot();
    globalThis.__tuck = { db };
    // Don't cache a failed boot: the next request retries.
    db.catch(() => {
      if (globalThis.__tuck?.db === db) globalThis.__tuck = undefined;
    });
  }
  return globalThis.__tuck.db;
}

export function getDeps(): Promise<EngineDeps> {
  void getDb();
  globalThis.__tuck!.deps ??= getDb().then((db) => {
    const deps = createEngineDeps(db, process.env);
    // With the embedded DB only one process can open it, so jobs run inside the web process.
    if (!env.DATABASE_URL || env.WORKER_INLINE === "true") startInlineWorker(deps);
    return deps;
  });
  return globalThis.__tuck!.deps!;
}
