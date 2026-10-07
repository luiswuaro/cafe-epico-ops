import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryItems,
  inventoryMovements,
  inventoryCountLines,
  recipeComponents,
  loyverseInventoryMappings,
  itemCostHistory,
  itemPurchaseUnits,
} from "@/src/infrastructure/db/schema";

export async function getInventoryCatalogAdmin(organizationId: string) {
  const db = getDb();

  const items = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      category: inventoryItems.category,
      canonicalUnit: inventoryItems.canonicalUnit,
      minimumStock: inventoryItems.minimumStock,
      densityGPerMl: inventoryItems.densityGPerMl,
      isActive: inventoryItems.isActive,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.organizationId, organizationId))
    .orderBy(asc(inventoryItems.category), asc(inventoryItems.name));

  return items;
}

export async function getInventoryItemUnitDependencies(
  organizationId: string,
  inventoryItemId: string,
) {
  const db = getDb();

  const [row] = await db
    .select({
      movements: sql<number>`count(distinct ${inventoryMovements.id})`,
      countLines: sql<number>`count(distinct ${inventoryCountLines.id})`,
      recipeComponents: sql<number>`count(distinct ${recipeComponents.id})`,
      loyverseMappings: sql<number>`count(distinct ${loyverseInventoryMappings.id})`,
      costRows: sql<number>`count(distinct ${itemCostHistory.id})`,
      purchaseUnits: sql<number>`count(distinct ${itemPurchaseUnits.id})`,
    })
    .from(inventoryItems)
    .leftJoin(
      inventoryMovements,
      and(
        eq(inventoryMovements.inventoryItemId, inventoryItems.id),
        eq(inventoryMovements.organizationId, organizationId),
      ),
    )
    .leftJoin(
      inventoryCountLines,
      and(
        eq(inventoryCountLines.inventoryItemId, inventoryItems.id),
        eq(inventoryCountLines.organizationId, organizationId),
      ),
    )
    .leftJoin(
      recipeComponents,
      and(
        eq(recipeComponents.inventoryItemId, inventoryItems.id),
        eq(recipeComponents.organizationId, organizationId),
      ),
    )
    .leftJoin(
      loyverseInventoryMappings,
      and(
        eq(loyverseInventoryMappings.inventoryItemId, inventoryItems.id),
        eq(loyverseInventoryMappings.organizationId, organizationId),
      ),
    )
    .leftJoin(
      itemCostHistory,
      and(
        eq(itemCostHistory.inventoryItemId, inventoryItems.id),
        eq(itemCostHistory.organizationId, organizationId),
      ),
    )
    .leftJoin(
      itemPurchaseUnits,
      and(
        eq(itemPurchaseUnits.inventoryItemId, inventoryItems.id),
        eq(itemPurchaseUnits.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(inventoryItems.id, inventoryItemId),
        eq(inventoryItems.organizationId, organizationId),
      ),
    )
    .groupBy(inventoryItems.id)
    .limit(1);

  const result = row ?? {
    movements: 0,
    countLines: 0,
    recipeComponents: 0,
    loyverseMappings: 0,
    costRows: 0,
    purchaseUnits: 0,
  };

  return {
    ...result,
    total:
      Number(result.movements) +
      Number(result.countLines) +
      Number(result.recipeComponents) +
      Number(result.loyverseMappings) +
      Number(result.costRows) +
      Number(result.purchaseUnits),
  };
}
