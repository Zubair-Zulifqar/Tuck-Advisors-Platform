import type { Db, Queryable } from "./driver";

export interface OrgContext {
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "analyst" | "viewer";
}

/**
 * Runs `fn` in a transaction as the Postgres `authenticated` role with the caller's identity set,
 * so Supabase RLS policies apply to every statement — the server cannot accidentally read another
 * organisation's rows even if a query forgets its organization_id filter.
 */
export async function withOrg<T>(db: Db, ctx: OrgContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('app.user_id', $1, true)", [ctx.userId]);
    await tx.query("set local role authenticated");
    return fn(tx);
  });
}

/** Privileged access for system jobs (workers, webhooks, public analyzer). Still sets an actor for audit. */
export async function asSystem<T>(db: Db, fn: (tx: Queryable) => Promise<T>, actorUserId?: string): Promise<T> {
  return db.transaction(async (tx) => {
    if (actorUserId) await tx.query("select set_config('app.user_id', $1, true)", [actorUserId]);
    return fn(tx);
  });
}
