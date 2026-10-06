import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  integrationConnections,
  loyverseCustomers,
  loyverseInventoryLevels,
  loyverseItems,
  loyverseReceipts,
  loyverseStores,
  loyverseVariants,
  syncStates,
} from "@/src/infrastructure/db/schema";

export async function getLoyverseStatus(organizationId: string) {
  const db = getDb();

  const [connection] = await db
    .select({
      id: integrationConnections.id,
      status: integrationConnections.status,
      updatedAt: integrationConnections.updatedAt,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        eq(integrationConnections.provider, "LOYVERSE"),
      ),
    )
    .limit(1);

  const [
    [storesRow],
    [itemsRow],
    [variantsRow],
    [inventoryRow],
    [customersRow],
    [receiptsRow],
    states,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseStores)
      .where(eq(loyverseStores.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseItems)
      .where(eq(loyverseItems.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseVariants)
      .where(eq(loyverseVariants.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseInventoryLevels)
      .where(eq(loyverseInventoryLevels.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseCustomers)
      .where(eq(loyverseCustomers.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(loyverseReceipts)
      .where(eq(loyverseReceipts.organizationId, organizationId)),
    connection
      ? db
          .select({
            resource: syncStates.resource,
            status: syncStates.status,
            lastSuccessfulSyncAt: syncStates.lastSuccessfulSyncAt,
            lastAttemptAt: syncStates.lastAttemptAt,
            errorMessage: syncStates.errorMessage,
          })
          .from(syncStates)
          .where(eq(syncStates.integrationConnectionId, connection.id))
      : Promise.resolve([]),
  ]);

  return {
    connection: connection ?? null,
    counts: {
      stores: storesRow?.count ?? 0,
      items: itemsRow?.count ?? 0,
      variants: variantsRow?.count ?? 0,
      inventoryLevels: inventoryRow?.count ?? 0,
      customers: customersRow?.count ?? 0,
      receipts: receiptsRow?.count ?? 0,
    },
    states,
  };
}
