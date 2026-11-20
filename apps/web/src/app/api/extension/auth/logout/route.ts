import { z } from "zod";
import { revokeRefreshToken } from "@/server/auth";
import { fail, ok, preflight } from "@/server/api";
import { getDb } from "@/server/db";

const body = z.object({ refreshToken: z.string().max(200).optional() });
export const OPTIONS = preflight;

export async function POST(req: Request) {
  try {
    const { refreshToken } = body.parse(await req.json().catch(() => ({})));
    if (refreshToken) await revokeRefreshToken(await getDb(), refreshToken);
    return ok(req, { ok: true });
  } catch (e) {
    return fail(req, e);
  }
}
