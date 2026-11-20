import { NextResponse } from "next/server";
import { asSystem } from "@tuck/db";
import { applyDeliveryEvent } from "@tuck/engine";
import { mapResendEvent, verifySvix } from "@tuck/integrations";
import { getDb, getDeps } from "@/server/db";
import { env } from "@/server/env";

/** Resend delivery webhooks (Svix-signed). Idempotent by svix-id. */
export async function POST(req: Request) {
  if (!env.RESEND_WEBHOOK_SECRET) return NextResponse.json({ error: { message: "Webhook not configured" } }, { status: 503 });
  const raw = await req.text();
  const h = { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") };
  if (!verifySvix(env.RESEND_WEBHOOK_SECRET, raw, h)) return NextResponse.json({ error: { message: "Invalid signature" } }, { status: 401 });
  const evt = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  const db = await getDb();
  const fresh = await asSystem(db, async (tx) => (await tx.query("insert into public.webhook_events (provider, event_id, payload) values ('resend',$1,$2) on conflict do nothing returning id", [h.id, raw])).rows.length > 0);
  if (!fresh) return NextResponse.json({ data: { duplicate: true } });
  const mapped = mapResendEvent(evt);
  if (mapped) await applyDeliveryEvent(await getDeps(), mapped);
  return NextResponse.json({ data: { processed: !!mapped } });
}
