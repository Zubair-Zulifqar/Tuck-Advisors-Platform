import { NextResponse } from "next/server";
import { safeEqual } from "@tuck/integrations";
import { getDeps } from "@/server/db";
import { env } from "@/server/env";
import { runAllQueues } from "@/server/worker";

export const maxDuration = 300;

/** Scheduled queue processing for serverless deployments (Vercel Cron). Bearer CRON_SECRET required. */
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!env.CRON_SECRET || !safeEqual(token, env.CRON_SECRET)) return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  return NextResponse.json({ data: await runAllQueues(await getDeps()) });
}
