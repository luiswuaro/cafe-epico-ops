import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseInventoryLevels,
  loyverseInventorySnapshots,
  loyverseItemSettings,
  loyverseItems,
  loyverseVariants,
  operationalInventoryBalances,
  operationalInventoryMovements,
} from "@/src/infrastructure/db/schema";

export async function getOperationalIngredientHistory(
  organizationId: string,
  storeId: string,
  variantExternalId: string,
  days = 30,
) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);

  const [variant] = await db
    .select({
      externalId: loyverseVariants.externalId,
      itemExternalId: loyverseVariants.loyverseItemExternalId,
      sku: loyverseVariants.sku,
    })
    .from(loyverseVariants)
    .where(
      and(
        eq(loyverseVariants.organizationId, organizationId),
        eq(loyverseVariants.externalId, variantExternalId),
      ),
    )
    .limit(1);

  if (!variant?.itemExternalId) return null;

  const [[item], [setting], [balance], levels, snapshots, movements] =
    await Promise.all([
      db
        .select({
          name: loyverseItems.itemName,
          payload: loyverseItems.payload,
        })
        .from(loyverseItems)
        .where(
          and(
            eq(loyverseItems.organizationId, organizationId),
            eq(loyverseItems.externalId, variant.itemExternalId),
          ),
        )
        .limit(1),
      db
        .select({
          displayUnit: loyverseItemSettings.displayUnit,
          displayFactor: loyverseItemSettings.displayFactor,
        })
        .from(loyverseItemSettings)
        .where(
          and(
            eq(loyverseItemSettings.organizationId, organizationId),
            eq(
              loyverseItemSettings.variantExternalId,
              variantExternalId,
            ),
          ),
        )
        .limit(1),
      db
        .select()
        .from(operationalInventoryBalances)
        .where(
          and(
            eq(operationalInventoryBalances.organizationId, organizationId),
            eq(operationalInventoryBalances.storeId, storeId),
            eq(
              operationalInventoryBalances.variantExternalId,
              variantExternalId,
            ),
          ),
        )
        .limit(1),
      db
        .select({
          inStock: loyverseInventoryLevels.inStock,
          syncedAt: loyverseInventoryLevels.syncedAt,
          storeExternalId: loyverseInventoryLevels.storeExternalId,
        })
        .from(loyverseInventoryLevels)
        .where(
          and(
            eq(loyverseInventoryLevels.organizationId, organizationId),
            eq(
              loyverseInventoryLevels.variantExternalId,
              variantExternalId,
            ),
          ),
        ),
      db
        .select({
          inStock: loyverseInventorySnapshots.inStock,
          capturedAt: loyverseInventorySnapshots.capturedAt,
        })
        .from(loyverseInventorySnapshots)
        .where(
          and(
            eq(loyverseInventorySnapshots.organizationId, organizationId),
            eq(
              loyverseInventorySnapshots.variantExternalId,
              variantExternalId,
            ),
            gte(loyverseInventorySnapshots.capturedAt, since),
          ),
        )
        .orderBy(desc(loyverseInventorySnapshots.capturedAt)),
      db
        .select({
          id: operationalInventoryMovements.id,
          movementType: operationalInventoryMovements.movementType,
          quantityDeltaNative:
            operationalInventoryMovements.quantityDeltaNative,
          sourceType: operationalInventoryMovements.sourceType,
          sourceId: operationalInventoryMovements.sourceId,
          orderId: operationalInventoryMovements.orderId,
          occurredAt: operationalInventoryMovements.occurredAt,
          note: operationalInventoryMovements.note,
        })
        .from(operationalInventoryMovements)
        .where(
          and(
            eq(
              operationalInventoryMovements.organizationId,
              organizationId,
            ),
            eq(operationalInventoryMovements.storeId, storeId),
            eq(
              operationalInventoryMovements.variantExternalId,
              variantExternalId,
            ),
            gte(operationalInventoryMovements.occurredAt, since),
          ),
        )
        .orderBy(desc(operationalInventoryMovements.occurredAt)),
    ]);

  if (!item) return null;

  const displayFactor = Number(setting?.displayFactor ?? 1);
  const displayUnit =
    setting?.displayUnit ??
    (item.payload.sold_by_weight ? "unidad Loyverse" : "pz");

  const sourceLevel =
    levels.find(
      (level) =>
        balance &&
        level.storeExternalId === balance.loyverseStoreExternalId,
    ) ??
    levels[0] ??
    null;

  const latestPositive = movements.find(
    (movement) =>
      Number(movement.quantityDeltaNative) > 0 &&
      ["RESTOCK", "COUNT_ADJUSTMENT", "OPENING_BALANCE"].includes(
        movement.movementType,
      ),
  );

  const saleConsumption = movements
    .filter((movement) => movement.movementType === "SALE")
    .reduce(
      (sum, movement) =>
        sum + Math.abs(Number(movement.quantityDeltaNative)),
      0,
    );

  const wasteConsumption = movements
    .filter((movement) => movement.movementType === "WASTE")
    .reduce(
      (sum, movement) =>
        sum + Math.abs(Number(movement.quantityDeltaNative)),
      0,
    );

  return {
    variantExternalId,
    itemName: item.name,
    sku: variant.sku,
    displayFactor,
    displayUnit,
    currentOpsNative: balance ? Number(balance.quantityNative) : null,
    currentSourceNative: sourceLevel ? Number(sourceLevel.inStock) : null,
    sourceSyncedAt: sourceLevel?.syncedAt ?? null,
    operationalUpdatedAt: balance?.updatedAt ?? null,
    initializedAt: balance?.initializedAt ?? null,
    sourceAtInitializationNative: balance
      ? Number(balance.sourceQuantityNative)
      : null,
    latestPositiveAt: latestPositive?.occurredAt ?? null,
    saleConsumptionNative: saleConsumption,
    wasteConsumptionNative: wasteConsumption,
    snapshots: snapshots.map((row) => ({
      quantityNative: Number(row.inStock),
      capturedAt: row.capturedAt,
    })),
    movements: movements.map((row) => ({
      ...row,
      quantityDeltaNative: Number(row.quantityDeltaNative),
    })),
  };
}
