import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./driver";

/** Locate supabase/migrations whether running from source, a bundled Next.js server, or a container. */
export function findMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    (() => {
      try {
        return resolve(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
      } catch {
        return undefined;
      }
    })(),
    resolve(process.cwd(), "supabase/migrations"),
    resolve(process.cwd(), "../../supabase/migrations"),
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Could not find supabase/migrations (looked in: ${candidates.join(", ")}). Set MIGRATIONS_DIR.`);
  return found;
}

/** Forward-only migration runner. Each file runs atomically; applied files are never re-run or rewritten. */
export async function migrate(db: Db, dir = findMigrationsDir()): Promise<string[]> {
  await db.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await db.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => /^[\w.-]+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = await readFile(join(dir, f), "utf8");
    try {
      await db.exec(`begin;\n${sql}\n;\ninsert into public.schema_migrations(name) values ('${f}');\ncommit;`);
    } catch (e) {
      await db.exec("rollback").catch(() => undefined);
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
    ran.push(f);
  }
  return ran;
}
