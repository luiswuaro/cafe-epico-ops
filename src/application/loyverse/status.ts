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
} from "@/src/infrastructure/db/schema";

async function countRows(table: typeof loyverseStores, organizationId: string) {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.organizationId, organizationId));
  return row?.count ?? 0;
}

export async function getLoyverseIntegrationStatus(organizationId: string) {
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
    stores,
    items,
    variants,
    inventoryLevels,
    customers,
    receipts,
  ] = await Promise.all([
    countRows(loyverseStores, organizationId),
    countRows(loyverseItems, organizationId),
    countRows(loyverseVariants, organizationId),
    countRows(loyverseInventoryLevels, organizationId),
    countRows(loyverseCustomers, organizationId),
    countRows(loyverseReceipts, organizationId),
  ]);

  return {
    configured: Boolean(process.env.LOYVERSE_ACCESS_TOKEN),
    connectionStatus: connection?.status ?? "DISCONNECTED",
    connectionUpdatedAt: connection?.updatedAt ?? null,
    counts: {
      stores,
      items,
      variants,
      inventoryLevels,
      customers,
      receipts,
    },
  };
}
