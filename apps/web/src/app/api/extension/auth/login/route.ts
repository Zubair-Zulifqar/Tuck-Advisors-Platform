import { z } from "zod";
import { authenticate, issueExtensionTokens, loadContext, verifyToken } from "@/server/auth";
import { HttpError, fail, ok, preflight } from "@/server/api";
import { getDb } from "@/server/db";
import { clientIp, rateLimit } from "@/server/ratelimit";

const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
export const OPTIONS = preflight;

export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => ({})));
    const rl = rateLimit(`ext-login:${clientIp(req)}:${input.email.toLowerCase()}`, 8, 15 * 60_000);
    if (!rl.ok) throw new HttpError(429, "Too many sign-in attempts. Try again later.");
    const db = await getDb();
    const { userId, organizationId } = await authenticate(db, input.email, input.password);
    const tokens = await issueExtensionTokens(db, userId, organizationId);
    const ctx = await loadContext(db, verifyToken(tokens.accessToken)!, "bearer");
    return ok(req, { ...tokens, user: { id: userId, email: ctx!.email, name: ctx!.name, organizationId, role: ctx!.role } });
  } catch (e) {
    return fail(req, e);
  }
}
