import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { webhookEvents } from "@/src/infrastructure/db/schema";
import { syncLoyverseCustomers, syncLoyverseInventory, syncLoyverseItems, syncLoyverseReceipts } from "./sync";

export async function processPendingLoyverseWebhooks(limit = 100) {
  const db = getDb();
  const events = await db.select().from(webhookEvents)
    .where(eq(webhookEvents.status, "RECEIVED"))
    .orderBy(asc(webhookEvents.receivedAt)).limit(limit);
  if (!events.length) return { processed: 0 };

  const ids = events.map((e) => e.id);
  await db.update(webhookEvents).set({ status: "PROCESSING" }).where(inArray(webhookEvents.id, ids));
  const since = new Date(Math.min(...events.map((e) => e.receivedAt.getTime())) - 5 * 60_000).toISOString();
  try {
    const types = new Set(events.map((e) => e.eventType));
    if (types.has("items.update")) await syncLoyverseItems(since);
    if (types.has("inventory_levels.update")) await syncLoyverseInventory(since);
    if (types.has("customers.update")) await syncLoyverseCustomers(since);
    if (types.has("receipts.update")) await syncLoyverseReceipts(since);
    await db.update(webhookEvents).set({ status: "PROCESSED", processedAt: new Date(), lastError: null }).where(inArray(webhookEvents.id, ids));
    return { processed: events.length };
  } catch (error) {
    await db.update(webhookEvents).set({ status: "FAILED", lastError: error instanceof Error ? error.message : "unknown" }).where(inArray(webhookEvents.id, ids));
    throw error;
  }
}
