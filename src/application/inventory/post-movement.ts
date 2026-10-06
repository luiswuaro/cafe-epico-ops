import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { inventoryBalances, inventoryMovements } from "@/src/infrastructure/db/schema";

type PostMovement = typeof inventoryMovements.$inferInsert;

export async function postInventoryMovement(input: PostMovement) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [movement] = await tx.insert(inventoryMovements).values(input).returning();
    await tx.insert(inventoryBalances).values({
      organizationId: input.organizationId,
      storeId: input.storeId,
      locationId: input.locationId,
      inventoryItemId: input.inventoryItemId,
      theoreticalQuantity: String(input.quantityDelta),
    }).onConflictDoUpdate({
      target: [inventoryBalances.storeId, inventoryBalances.locationId, inventoryBalances.inventoryItemId],
      set: {
        theoreticalQuantity: sql`${inventoryBalances.theoreticalQuantity} + ${input.quantityDelta}`,
        updatedAt: new Date(),
      },
    });
    return movement;
  });
}

export async function getTheoreticalBalance(storeId: string, locationId: string, inventoryItemId: string) {
  const db = getDb();
  const [row] = await db.select().from(inventoryBalances).where(and(
    eq(inventoryBalances.storeId, storeId),
    eq(inventoryBalances.locationId, locationId),
    eq(inventoryBalances.inventoryItemId, inventoryItemId),
  )).limit(1);
  return row?.theoreticalQuantity ?? "0";
}
