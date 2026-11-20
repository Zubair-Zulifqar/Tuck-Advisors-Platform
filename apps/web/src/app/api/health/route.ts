import { NextResponse } from "next/server";
import { integrationStatuses } from "@tuck/integrations";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.query("select 1");
    const integrations = integrationStatuses(process.env).map(({ provider, mode }) => ({ provider, mode }));
    return NextResponse.json({ status: "ok", database: db.kind, integrations });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "health.failed", error: (e as Error).message }));
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
