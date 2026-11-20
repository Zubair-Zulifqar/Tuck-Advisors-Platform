import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withOrg, type Queryable } from "@tuck/db";
import { roleHas, type Permission } from "@tuck/shared";
import { SESSION_COOKIE, loadContext, verifyToken, type AuthContext } from "./auth";
import { getDb, getDeps } from "./db";

/** For server components: current user or null. */
export async function currentUser(): Promise<AuthContext | null> {
  const claims = verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims || claims.typ !== "web") return null;
  const db = await getDb();
  await getDeps();
  return loadContext(db, claims, "session");
}

export async function requireUser(): Promise<AuthContext> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

/** Run read queries for a server component as the signed-in user, under RLS. */
export async function query<T>(fn: (tx: Queryable, auth: AuthContext) => Promise<T>): Promise<T> {
  const auth = await requireUser();
  const db = await getDb();
  return withOrg(db, auth, (tx) => fn(tx, auth));
}

export function can(auth: AuthContext, p: Permission) {
  return roleHas(auth.role, p);
}
