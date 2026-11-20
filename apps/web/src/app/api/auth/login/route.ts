import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthFailure, SESSION_COOKIE, WEB_SESSION_TTL_S, authenticate, signToken } from "@/server/auth";
import { HttpError, fail } from "@/server/api";
import { getDb } from "@/server/db";
import { env } from "@/server/env";
import { clientIp, rateLimit } from "@/server/ratelimit";

const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new HttpError(403, "Cross-site request blocked");
    const input = body.parse(await req.json().catch(() => ({})));
    const rl = rateLimit(`login:${clientIp(req)}:${input.email.toLowerCase()}`, 8, 15 * 60_000);
    if (!rl.ok) throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
    const db = await getDb();
    const { userId, organizationId } = await authenticate(db, input.email, input.password).catch((e) => {
      throw e instanceof AuthFailure ? e : new AuthFailure("Invalid email or password");
    });
    const token = signToken({ sub: userId, org: organizationId, typ: "web", exp: Math.floor(Date.now() / 1000) + WEB_SESSION_TTL_S });
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: WEB_SESSION_TTL_S });
    return res;
  } catch (e) {
    return fail(req, e);
  }
}
