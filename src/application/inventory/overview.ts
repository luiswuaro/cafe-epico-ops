import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances,
  inventoryCountLines,
  inventoryCounts,
  inventoryItems,
  inventoryLocations,
} from "@/src/infrastructure/db/schema";

export async function getInventoryOverview(
  organizationId: string,
  storeId: string,
  requestedLocationId?: string,
) {
  const db = getDb();

  const locations = await db
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

  const selectedLocation =
    locations.find((location) => location.id === requestedLocationId) ??
    locations[0] ??
    null;

  if (!selectedLocation) {
    return { locations, selectedLocation: null, rows: [] };
  }

  const [items, balances, countLines] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        category: inventoryItems.category,
        canonicalUnit: inventoryItems.canonicalUnit,
        minimumStock: inventoryItems.minimumStock,
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
        updatedAt: inventoryBalances.updatedAt,
      })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.storeId, storeId),
          eq(inventoryBalances.locationId, selectedLocation.id),
        ),
      ),
    db
      .select({
        inventoryItemId: inventoryCountLines.inventoryItemId,
        physicalQuantity: inventoryCountLines.physicalQuantity,
        countedAt: inventoryCountLines.countedAt,
      })
      .from(inventoryCountLines)
      .innerJoin(
        inventoryCounts,
        eq(inventoryCounts.id, inventoryCountLines.inventoryCountId),
      )
      .where(
        and(
          eq(inventoryCounts.organizationId, organizationId),
          eq(inventoryCounts.storeId, storeId),
          eq(inventoryCounts.locationId, selectedLocation.id),
          eq(inventoryCounts.status, "COMPLETED"),
        ),
      )
      .orderBy(desc(inventoryCountLines.countedAt)),
  ]);

  const balanceByItem = new Map(
    balances.map((row) => [row.inventoryItemId, row]),
  );

  const latestPhysicalByItem = new Map<
    string,
    { physicalQuantity: string; countedAt: Date }
  >();

  for (const row of countLines) {
    if (!latestPhysicalByItem.has(row.inventoryItemId)) {
      latestPhysicalByItem.set(row.inventoryItemId, {
        physicalQuantity: row.physicalQuantity,
        countedAt: row.countedAt,
      });
    }
  }

  const rows = items.map((item) => {
    const balance = balanceByItem.get(item.id);
    const latestPhysical = latestPhysicalByItem.get(item.id);
    const theoretical = Number(balance?.theoreticalQuantity ?? 0);
    const physical = latestPhysical
      ? Number(latestPhysical.physicalQuantity)
      : null;
    const deviation = physical == null ? null : physical - theoretical;
    const deviationPct =
      physical == null || theoretical === 0
        ? null
        : deviation! / theoretical;

    return {
      ...item,
      theoretical,
      hasTheoreticalBalance: Boolean(balance),
      theoreticalUpdatedAt: balance?.updatedAt ?? null,
      physical,
      countedAt: latestPhysical?.countedAt ?? null,
      deviation,
      deviationPct,
    };
  });

  return { locations, selectedLocation, rows };
}
