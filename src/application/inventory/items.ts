import { asc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { inventoryItems } from "@/src/infrastructure/db/schema";

export async function listActiveInventoryItems(organizationId: string) {
  return getDb()
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      category: inventoryItems.category,
      canonicalUnit: inventoryItems.canonicalUnit,
      minimumStock: inventoryItems.minimumStock,
      densityGPerMl: inventoryItems.densityGPerMl,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.organizationId, organizationId))
    .orderBy(asc(inventoryItems.category), asc(inventoryItems.name));
}
