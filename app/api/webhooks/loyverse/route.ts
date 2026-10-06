import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/src/infrastructure/db/client";
import { organizations, webhookEvents } from "@/src/infrastructure/db/schema";
import { sha256, verifyLoyverseSignature, webhookEventKey, type LoyverseWebhookPayload } from "@/src/infrastructure/loyverse/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.LOYVERSE_WEBHOOK_CLIENT_SECRET;
  const signature = request.headers.get("x-loyverse-signature");
  if (secret) {
    const verification = verifyLoyverseSignature(rawBody, signature, secret);
    if (!verification.valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  } else {
    const expected = process.env.LOYVERSE_WEBHOOK_INGEST_TOKEN;
    const supplied = new URL(request.url).searchParams.get("token");
    if (!expected || !supplied || expected.length !== supplied.length) return NextResponse.json({ error: "unsigned_webhook_not_authorized" }, { status: 401 });
    const { timingSafeEqual } = await import("node:crypto");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return NextResponse.json({ error: "unsigned_webhook_not_authorized" }, { status: 401 });
  }

  let payload: LoyverseWebhookPayload;
  try { payload = JSON.parse(rawBody) as LoyverseWebhookPayload; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!payload.type) return NextResponse.json({ error: "missing_type" }, { status: 400 });

  const hash = sha256(rawBody);
  const db = getDb();
  const orgSlug = process.env.DEFAULT_ORGANIZATION_SLUG ?? "cafe-epico";
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, orgSlug)).limit(1);

  await db.insert(webhookEvents).values({ organizationId: org?.id, provider: "LOYVERSE", eventType: payload.type, externalEventKey: webhookEventKey(payload, hash), payload, payloadHash: hash }).onConflictDoNothing();
  return NextResponse.json({ accepted: true }, { status: 202 });
}
