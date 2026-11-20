/**
 * Minimal SQL driver abstraction. Production uses node-postgres against Supabase/Cloud SQL
 * (DATABASE_URL). Local development and tests use PGlite — real PostgreSQL compiled to WASM —
 * so migrations, constraints, triggers and RLS are exercised without Docker.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly kind: "pg" | "pglite";
}

export async function createPgDb(connectionString: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: /sslmode=require|supabase\.co/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    kind: "pg",
    async query(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({
          async query(sql, params) {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows };
          },
        });
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  // PGlite serialises access; a simple promise chain keeps transactions isolated from concurrent calls.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const q = async <T>(sql: string, params?: unknown[]) => {
    const r = await pg.query<T>(sql, params as unknown[]);
    return { rows: r.rows };
  };
  return {
    kind: "pglite",
    query: (sql, params) => serial(() => q(sql, params)),
    exec: (sql) => serial(async () => void (await pg.exec(sql))),
    transaction: (fn) =>
      serial(() =>
        pg.transaction(async (tx) =>
          fn({
            async query(sql, params) {
              const r = await tx.query(sql, params as unknown[]);
              return { rows: r.rows as never[] };
            },
          }),
        ),
      ),
    close: () => pg.close(),
  };
}
