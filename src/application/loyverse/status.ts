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

  const count = async (table: any) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.organizationId, organizationId));
    return row?.count ?? 0;
  };

  const [stores, items, variants, inventoryLevels, customers, receipts, states] =
    await Promise.all([
      count(loyverseStores),
      count(loyverseItems),
      count(loyverseVariants),
      count(loyverseInventoryLevels),
      count(loyverseCustomers),
      count(loyverseReceipts),
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
    counts: { stores, items, variants, inventoryLevels, customers, receipts },
    states,
  };
}
