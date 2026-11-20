import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { asSystem, randomToken, sha256, verifyPassword, type Db } from "@tuck/db";
import type { Role } from "@tuck/shared";
import { env, requireSessionSecret } from "./env";

export const SESSION_COOKIE = "tuck_session";
export const WEB_SESSION_TTL_S = 60 * 60 * 12;
export const EXT_ACCESS_TTL_S = 60 * 15;
export const EXT_REFRESH_TTL_S = 60 * 60 * 24 * 30;

export interface TokenClaims {
  sub: string;
  org: string;
  typ: "web" | "ext";
  exp: number; // epoch seconds
}

export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string | null;
  organizationName: string;
  via: "session" | "bearer";
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(claims: TokenClaims): string {
  const body = b64(JSON.stringify(claims));
  const sig = createHmac("sha256", requireSessionSecret()).update(`v1.${body}`).digest("base64url");
  return `v1.${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null, now = Math.floor(Date.now() / 1000)): TokenClaims | null {
  if (!token) return null;
  const [v, body, sig] = token.split(".");
  if (v !== "v1" || !body || !sig) return null;
  const expected = createHmac("sha256", requireSessionSecret()).update(`v1.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenClaims;
    return c.exp > now ? c : null;
  } catch {
    return null;
  }
}

/** Resolve token claims to a live membership — role changes and removals take effect immediately. */
export async function loadContext(db: Db, claims: TokenClaims, via: AuthContext["via"]): Promise<AuthContext | null> {
  const { rows } = await asSystem(db, (tx) =>
    tx.query<{ role: Role; email: string; name: string | null; org_name: string }>(
      `select m.role, u.email, u.name, o.name as org_name from public.memberships m
       join public.users u on u.id = m.user_id join public.organizations o on o.id = m.organization_id
       where m.user_id = $1 and m.organization_id = $2`,
      [claims.sub, claims.org],
    ),
  );
  const r = rows[0];
  if (!r) return null;
  return { userId: claims.sub, organizationId: claims.org, role: r.role, email: r.email, name: r.name, organizationName: r.org_name, via };
}

export class AuthFailure extends Error {
  status = 401;
}

/** Verify credentials against Supabase Auth when configured, otherwise the local scrypt hash. */
export async function authenticate(db: Db, emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = (
    await asSystem(db, (tx) =>
      tx.query<{ id: string; password_hash: string | null; auth_provider: string; organization_id: string | null }>(
        `select u.id, u.password_hash, u.auth_provider,
           (select m.organization_id from public.memberships m where m.user_id = u.id order by m.created_at limit 1) as organization_id
         from public.users u where u.email = $1`,
        [email],
      ),
    )
  ).rows[0];

  let ok = false;
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && user?.auth_provider === "supabase") {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    ok = !!res?.ok;
  } else {
    // Always run a hash comparison to keep timing similar for unknown users.
    ok = await verifyPassword(password, user?.password_hash ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    ok = ok && !!user;
  }
  if (!ok || !user) throw new AuthFailure("Invalid email or password");
  if (!user.organization_id) throw new AuthFailure("This account is not a member of any organisation");
  return { userId: user.id, organizationId: user.organization_id };
}

export async function issueExtensionTokens(db: Db, userId: string, organizationId: string) {
  const refresh = randomToken(32);
  await asSystem(db, (tx) =>
    tx.query("insert into public.auth_tokens (user_id, organization_id, token_hash, client, expires_at) values ($1,$2,$3,'extension', now() + make_interval(secs => $4))", [
      userId,
      organizationId,
      sha256(refresh),
      EXT_REFRESH_TTL_S,
    ]),
  );
  const exp = Math.floor(Date.now() / 1000) + EXT_ACCESS_TTL_S;
  return { accessToken: signToken({ sub: userId, org: organizationId, typ: "ext", exp }), refreshToken: refresh, expiresAt: exp * 1000 };
}

/** Refresh-token rotation with reuse detection: presenting a revoked token revokes the whole family. */
export async function rotateRefreshToken(db: Db, refreshToken: string) {
  const hash = sha256(refreshToken);
  const row = await asSystem(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; user_id: string; organization_id: string; revoked_at: string | null; expired: boolean }>(
      "select id, user_id, organization_id, revoked_at, expires_at < now() as expired from public.auth_tokens where token_hash = $1 and client = 'extension' for update",
      [hash],
    );
    const t = rows[0];
    if (!t) return null;
    if (t.revoked_at) {
      await tx.query("update public.auth_tokens set revoked_at = now() where user_id = $1 and client = 'extension' and revoked_at is null", [t.user_id]);
      return null;
    }
    if (t.expired) return null;
    await tx.query("update public.auth_tokens set revoked_at = now() where id = $1", [t.id]);
    return t;
  });
  if (!row) throw new AuthFailure("Session expired — please sign in again");
  return issueExtensionTokens(db, row.user_id, row.organization_id);
}

export async function revokeRefreshToken(db: Db, refreshToken: string) {
  await asSystem(db, (tx) => tx.query("update public.auth_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(refreshToken)]));
}
