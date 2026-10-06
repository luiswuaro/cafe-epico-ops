import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances,
  inventoryCountLines,
  inventoryCounts,
  inventoryItems,
  inventoryLocations,
} from "@/src/infrastructure/db/schema";

export async function listInventoryLocations(
  organizationId: string,
  storeId: string,
) {
  return getDb()
    .select({
      id: inventoryLocations.id,
      name: inventoryLocations.name,
      locationType: inventoryLocations.locationType,
    })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.organizationId, organizationId),
        eq(inventoryLocations.storeId, storeId),
        eq(inventoryLocations.isActive, true),
      ),
    )
    .orderBy(asc(inventoryLocations.name));
}

export async function listRecentInventoryCounts(
  organizationId: string,
  storeId: string,
) {
  return getDb()
    .select({
      id: inventoryCounts.id,
      status: inventoryCounts.status,
      startedAt: inventoryCounts.startedAt,
      completedAt: inventoryCounts.completedAt,
      locationName: inventoryLocations.name,
    })
    .from(inventoryCounts)
    .innerJoin(
      inventoryLocations,
      eq(inventoryLocations.id, inventoryCounts.locationId),
    )
    .where(
      and(
        eq(inventoryCounts.organizationId, organizationId),
        eq(inventoryCounts.storeId, storeId),
      ),
    )
    .orderBy(desc(inventoryCounts.startedAt))
    .limit(20);
}

export async function getInventoryCountDetail(
  organizationId: string,
  storeId: string,
  countId: string,
) {
  const db = getDb();

  const [count] = await db
    .select({
      id: inventoryCounts.id,
      status: inventoryCounts.status,
      locationId: inventoryCounts.locationId,
      locationName: inventoryLocations.name,
      startedAt: inventoryCounts.startedAt,
      completedAt: inventoryCounts.completedAt,
    })
    .from(inventoryCounts)
    .innerJoin(
      inventoryLocations,
      eq(inventoryLocations.id, inventoryCounts.locationId),
    )
    .where(
      and(
        eq(inventoryCounts.id, countId),
        eq(inventoryCounts.organizationId, organizationId),
        eq(inventoryCounts.storeId, storeId),
      ),
    )
    .limit(1);

  if (!count) return null;

  const [items, balances, lines] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        category: inventoryItems.category,
        canonicalUnit: inventoryItems.canonicalUnit,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, organizationId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .orderBy(asc(inventoryItems.category), asc(inventoryItems.name)),
    db
      .select({
        inventoryItemId: inventoryBalances.inventoryItemId,
        theoreticalQuantity: inventoryBalances.theoreticalQuantity,
      })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.storeId, storeId),
          eq(inventoryBalances.locationId, count.locationId),
        ),
      ),
    db
      .select()
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, countId)),
  ]);

  const balanceByItem = new Map(
    balances.map((row) => [row.inventoryItemId, row.theoreticalQuantity]),
  );
  const lineByItem = new Map(
    lines.map((row) => [row.inventoryItemId, row]),
  );

  return {
    count,
    countedItems: lines.length,
    items: items.map((item) => ({
      ...item,
      theoreticalCurrent: balanceByItem.get(item.id) ?? "0",
      line: lineByItem.get(item.id) ?? null,
    })),
  };
}
