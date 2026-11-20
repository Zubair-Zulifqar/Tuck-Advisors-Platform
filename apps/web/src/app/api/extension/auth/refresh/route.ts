import { z } from "zod";
import { loadContext, rotateRefreshToken, verifyToken, AuthFailure } from "@/server/auth";
import { HttpError, fail, ok, preflight } from "@/server/api";
import { getDb } from "@/server/db";
import { clientIp, rateLimit } from "@/server/ratelimit";

const body = z.object({ refreshToken: z.string().min(20).max(200) });
export const OPTIONS = preflight;

export async function POST(req: Request) {
  try {
    if (!rateLimit(`ext-refresh:${clientIp(req)}`, 60, 60_000).ok) throw new HttpError(429, "Too many requests");
    const { refreshToken } = body.parse(await req.json().catch(() => ({})));
    const db = await getDb();
    const tokens = await rotateRefreshToken(db, refreshToken);
    const ctx = await loadContext(db, verifyToken(tokens.accessToken)!, "bearer");
    if (!ctx) throw new AuthFailure("Membership no longer active");
    return ok(req, { ...tokens, user: { id: ctx.userId, email: ctx.email, name: ctx.name, organizationId: ctx.organizationId, role: ctx.role } });
  } catch (e) {
    return fail(req, e);
  }
}
