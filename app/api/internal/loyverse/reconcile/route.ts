import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { initialSyncLoyverse, reconcileLoyverse } from "@/src/application/loyverse/sync";
import { processPendingLoyverseWebhooks } from "@/src/application/loyverse/process-webhooks";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a,b);
}
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "initial") return NextResponse.json({ ok: true, mode, ...(await initialSyncLoyverse(90)) });
    const webhookResult = await processPendingLoyverseWebhooks();
    return NextResponse.json({ ok: true, mode: "reconcile", webhooks: webhookResult, ...(await reconcileLoyverse()) });
  }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, { status: 500 }); }
}
