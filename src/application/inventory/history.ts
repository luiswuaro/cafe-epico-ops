import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryBalances,
  inventoryCountLines,
  inventoryCounts,
  inventoryItems,
  inventoryLocations,
  inventoryMovements,
} from "@/src/infrastructure/db/schema";

const CONSUMPTION_TYPES = new Set([
  "SALE",
  "WASTE",
  "PRODUCTION_CONSUMPTION",
]);

function dateKey(date: Date, timeZone = "America/Mexico_City") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function buildDateKeys(days: number, timeZone = "America/Mexico_City") {
  const keys: string[] = [];
  const now = new Date();

  for (let offset = days - 1; offset >= 0; offset--) {
    keys.push(
      dateKey(
        new Date(now.getTime() - offset * 86_400_000),
        timeZone,
      ),
    );
  }

  return keys;
}

export async function getInventoryItemHistory(
  organizationId: string,
  storeId: string,
  inventoryItemId: string,
  days = 30,
) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);

  const [item] = await db
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
        eq(inventoryItems.id, inventoryItemId),
        eq(inventoryItems.organizationId, organizationId),
        eq(inventoryItems.isActive, true),
      ),
    )
    .limit(1);

  if (!item) return null;

  const [
    [balance],
    movements,
    recentMovements,
    recentCounts,
  ] = await Promise.all([
    db
      .select({
        theoreticalQuantity: sql<string>`coalesce(sum(${inventoryBalances.theoreticalQuantity}), 0)`,
      })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.storeId, storeId),
          eq(inventoryBalances.inventoryItemId, inventoryItemId),
        ),
      ),
    db
      .select({
        movementType: inventoryMovements.movementType,
        quantityDelta: inventoryMovements.quantityDelta,
        occurredAt: inventoryMovements.occurredAt,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.organizationId, organizationId),
          eq(inventoryMovements.storeId, storeId),
          eq(inventoryMovements.inventoryItemId, inventoryItemId),
          gte(inventoryMovements.occurredAt, since),
        ),
      )
      .orderBy(inventoryMovements.occurredAt),
    db
      .select({
        id: inventoryMovements.id,
        movementType: inventoryMovements.movementType,
        quantityDelta: inventoryMovements.quantityDelta,
        occurredAt: inventoryMovements.occurredAt,
        note: inventoryMovements.note,
        locationName: inventoryLocations.name,
      })
      .from(inventoryMovements)
      .innerJoin(
        inventoryLocations,
        eq(inventoryLocations.id, inventoryMovements.locationId),
      )
      .where(
        and(
          eq(inventoryMovements.organizationId, organizationId),
          eq(inventoryMovements.storeId, storeId),
          eq(inventoryMovements.inventoryItemId, inventoryItemId),
        ),
      )
      .orderBy(desc(inventoryMovements.occurredAt))
      .limit(50),
    db
      .select({
        id: inventoryCountLines.id,
        physicalQuantity: inventoryCountLines.physicalQuantity,
        theoreticalQuantitySnapshot:
          inventoryCountLines.theoreticalQuantitySnapshot,
        deviationQuantity: inventoryCountLines.deviationQuantity,
        deviationPercentage: inventoryCountLines.deviationPercentage,
        countedAt: inventoryCountLines.countedAt,
        locationName: inventoryLocations.name,
      })
      .from(inventoryCountLines)
      .innerJoin(
        inventoryCounts,
        eq(inventoryCounts.id, inventoryCountLines.inventoryCountId),
      )
      .innerJoin(
        inventoryLocations,
        eq(inventoryLocations.id, inventoryCounts.locationId),
      )
      .where(
        and(
          eq(inventoryCountLines.inventoryItemId, inventoryItemId),
          eq(inventoryCounts.organizationId, organizationId),
          eq(inventoryCounts.storeId, storeId),
          eq(inventoryCounts.status, "COMPLETED"),
        ),
      )
      .orderBy(desc(inventoryCountLines.countedAt))
      .limit(20),
  ]);

  const keys = buildDateKeys(days);
  const daily = new Map(
    keys.map((key) => [
      key,
      { date: key, consumption: 0, waste: 0 },
    ]),
  );

  for (const movement of movements) {
    const delta = Number(movement.quantityDelta);
    if (delta >= 0 || !CONSUMPTION_TYPES.has(movement.movementType)) {
      continue;
    }

    const key = dateKey(movement.occurredAt);
    const point = daily.get(key);
    if (!point) continue;

    const quantity = Math.abs(delta);
    point.consumption += quantity;
    if (movement.movementType === "WASTE") {
      point.waste += quantity;
    }
  }

  const points = Array.from(daily.values());
  const totalConsumption = points.reduce(
    (sum, point) => sum + point.consumption,
    0,
  );
  const totalWaste = points.reduce((sum, point) => sum + point.waste, 0);
  const averageDailyConsumption = totalConsumption / days;
  const theoreticalQuantity = Number(balance?.theoreticalQuantity ?? 0);
  const daysCoverage =
    averageDailyConsumption > 0
      ? theoreticalQuantity / averageDailyConsumption
      : null;

  return {
    item,
    theoreticalQuantity,
    periodDays: days,
    points,
    totalConsumption,
    totalWaste,
    averageDailyConsumption,
    daysCoverage,
    recentMovements,
    recentCounts,
  };
}
