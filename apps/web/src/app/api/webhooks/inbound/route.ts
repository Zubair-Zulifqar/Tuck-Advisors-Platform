import { NextResponse } from "next/server";
import { z } from "zod";
import { asSystem } from "@tuck/db";
import { dispatchEvent, recordReply } from "@tuck/engine";
import { verifyWebhook } from "@tuck/integrations";
import { getDb, getDeps } from "@/server/db";
import { env } from "@/server/env";
import { clientIp, rateLimit } from "@/server/ratelimit";

/**
 * Zapier / Google Apps Script compatible inbound webhook. Requests are HMAC-signed
 * (X-Tuck-Signature: t=<unix>,v1=<hex>) with WEBHOOK_SIGNING_SECRET and must name the organisation.
 * Supported: {type:"webhook.received", ...} → triggers automations; {type:"outreach.reply", messageId} → reply detection.
 */
const body = z.object({
  organizationId: z.string().uuid(),
  eventId: z.string().min(1).max(200),
  type: z.enum(["webhook.received", "outreach.reply"]),
  messageId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
});

export async function POST(req: Request) {
  if (!env.WEBHOOK_SIGNING_SECRET) return NextResponse.json({ error: { message: "Webhook not configured" } }, { status: 503 });
  if (!rateLimit(`inbound:${clientIp(req)}`, 120, 60_000).ok) return NextResponse.json({ error: { message: "Too many requests" } }, { status: 429 });
  const raw = await req.text();
  if (!verifyWebhook(env.WEBHOOK_SIGNING_SECRET, raw, req.headers.get("x-tuck-signature"))) return NextResponse.json({ error: { message: "Invalid signature" } }, { status: 401 });
  const parsed = body.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return NextResponse.json({ error: { message: "Invalid payload", details: parsed.error.issues } }, { status: 422 });
  const b = parsed.data;
  const db = await getDb();
  const fresh = await asSystem(db, async (tx) => (await tx.query("insert into public.webhook_events (organization_id, provider, event_id, payload) values ($1,'inbound',$2,$3) on conflict do nothing returning id", [b.organizationId, b.eventId, raw])).rows.length > 0);
  if (!fresh) return NextResponse.json({ data: { duplicate: true } });
  const deps = await getDeps();
  if (b.type === "outreach.reply" && b.messageId) await recordReply(deps, b.organizationId, b.messageId);
  else await dispatchEvent(deps, b.organizationId, { type: "webhook.received", payload: b.payload, dedupeKey: `inbound:${b.eventId}` });
  return NextResponse.json({ data: { accepted: true } });
}
