import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, withOrg, type Db, type Queryable } from "@tuck/db";
import { IntegrationError } from "@tuck/integrations";
import { roleHas, type Permission } from "@tuck/shared";
import { AuthFailure, SESSION_COOKIE, loadContext, verifyToken, type AuthContext } from "./auth";
import { getDb, getDeps } from "./db";
import { env } from "./env";
import { clientIp, rateLimit } from "./ratelimit";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const EXT_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/** CORS only for the Chrome extension (bearer tokens, no cookies). Web UI is same-origin. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !EXT_ORIGIN.test(origin)) return {};
  const id = origin.slice("chrome-extension://".length);
  if (env.EXTENSION_IDS.length && !env.EXTENSION_IDS.includes(id)) return {};
  if (!env.EXTENSION_IDS.length && env.NODE_ENV === "production") return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-tuck-client",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export function preflight(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export function ok(req: Request, data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { ...corsHeaders(req), "cache-control": "no-store" } });
}

export function fail(req: Request, e: unknown) {
  const h = { ...corsHeaders(req), "cache-control": "no-store" };
  const out = (status: number, message: string, details?: unknown) => NextResponse.json({ error: { message, details } }, { status, headers: h });
  if (e instanceof HttpError) return out(e.status, e.message, e.details);
  if (e instanceof AuthFailure) return out(401, e.message);
  if (e instanceof ZodError) return out(422, "Validation failed", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  if (e instanceof ValidationError) return out(422, e.message, e.details);
  if (e instanceof NotFoundError) return out(404, e.message);
  if (e instanceof ConflictError) return out(409, e.message, e.details);
  if (e instanceof ForbiddenError) return out(403, e.message);
  if (e instanceof IntegrationError) return out(e.status && e.status >= 400 && e.status < 600 ? (e.status >= 500 ? 502 : e.status) : 502, e.message);
  const pgCode = (e as { code?: string }).code;
  if (pgCode === "23505") return out(409, "A record with these details already exists");
  if (pgCode === "42501") return out(403, "Not permitted by organisation access policy");
  console.error(JSON.stringify({ level: "error", msg: "api.unhandled", error: (e as Error).message, stack: (e as Error).stack?.split("\n").slice(0, 4) }));
  return out(500, "Something went wrong");
}

async function resolveAuth(req: Request, db: Db): Promise<AuthContext | null> {
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const claims = verifyToken(authz.slice(7));
    if (!claims) throw new AuthFailure("Invalid or expired access token");
    return loadContext(db, claims, "bearer");
  }
  const jar = await cookies();
  const claims = verifyToken(jar.get(SESSION_COOKIE)?.value);
  if (!claims || claims.typ !== "web") return null;
  // CSRF: cookie-authenticated state changes must come from our own origin.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked");
  }
  return loadContext(db, claims, "session");
}

export interface Handler<B> {
  req: Request;
  auth: AuthContext;
  body: B;
  db: Db;
  params: Record<string, string>;
  /** Runs fn as the caller under RLS. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  url: URL;
}

/**
 * Authenticated route wrapper: auth (session cookie or extension bearer), permission check, per-user
 * rate limit, body validation and uniform error mapping.
 */
export function route<S extends ZodTypeAny | undefined = undefined>(
  opts: { permission?: Permission; body?: S; rate?: [number, number] },
  fn: (h: Handler<S extends ZodTypeAny ? z.output<S> : undefined>) => Promise<Response | unknown>,
) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const db = await getDb();
      await getDeps();
      const auth = await resolveAuth(req, db);
      if (!auth) throw new AuthFailure("Not signed in");
      if (opts.permission && !roleHas(auth.role, opts.permission)) throw new ForbiddenError();
      const [limit, windowMs] = opts.rate ?? [240, 60_000];
      const rl = rateLimit(`u:${auth.userId}:${new URL(req.url).pathname}:${req.method}`, limit, windowMs);
      if (!rl.ok) throw new HttpError(429, "Too many requests — slow down", { retryAfterMs: rl.retryAfterMs });
      let body: unknown = undefined;
      if (opts.body) {
        const raw = await req.json().catch(() => {
          throw new HttpError(400, "Request body must be JSON");
        });
        body = opts.body.parse(raw);
      }
      const result = await fn({
        req,
        auth,
        db,
        body: body as never,
        params: (await ctx.params) ?? {},
        url: new URL(req.url),
        tx: (f) => withOrg(db, auth, f),
      });
      if (result instanceof Response) return result;
      return ok(req, result ?? null, req.method === "POST" ? 201 : 200);
    } catch (e) {
      return fail(req, e);
    }
  };
}

/** Public (unauthenticated) route wrapper with IP rate limiting. */
export function publicRoute<S extends ZodTypeAny>(opts: { body: S; rate: [number, number]; name: string }, fn: (h: { req: Request; body: z.output<S>; db: Db; ip: string }) => Promise<unknown>) {
  return async (req: Request) => {
    try {
      const ip = clientIp(req);
      const rl = rateLimit(`ip:${ip}:${opts.name}`, opts.rate[0], opts.rate[1]);
      if (!rl.ok) throw new HttpError(429, "Too many requests. Please try again later.", { retryAfterMs: rl.retryAfterMs });
      const raw = await req.json().catch(() => {
        throw new HttpError(400, "Request body must be JSON");
      });
      const body = opts.body.parse(raw);
      const db = await getDb();
      await getDeps();
      const data = await fn({ req, body, db, ip });
      return ok(req, data, 200);
    } catch (e) {
      return fail(req, e);
    }
  };
}
