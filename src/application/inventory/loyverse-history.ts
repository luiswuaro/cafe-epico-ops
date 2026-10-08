import { and, asc, desc, eq, gte } from "drizzle-orm";
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

function bool(value: unknown) {
  return value === true || value === "true";
}

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((row) => row.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateKeys(days: number) {
  const now = Date.now();
  return Array.from({ length: days }, (_, index) => {
    const offset = days - 1 - index;
    return dateKey(new Date(now - offset * 86_400_000));
  });
}

export async function getLoyverseIngredientHistory(
  organizationId: string,
  storeId: string,
  variantExternalId: string,
  days = 60,
) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000);

  const [[item], [balance]] = await Promise.all([
    db
      .select({
        variantExternalId: loyverseVariants.externalId,
        sku: loyverseVariants.sku,
        itemName: loyverseItems.itemName,
        payload: loyverseItems.payload,
        displayUnit: loyverseItemSettings.displayUnit,
        displayFactor: loyverseItemSettings.displayFactor,
      })
      .from(loyverseVariants)
      .innerJoin(
        loyverseItems,
        and(
          eq(
            loyverseItems.organizationId,
            loyverseVariants.organizationId,
          ),
          eq(
            loyverseItems.externalId,
            loyverseVariants.loyverseItemExternalId,
          ),
        ),
      )
      .leftJoin(
        loyverseItemSettings,
        and(
          eq(
            loyverseItemSettings.organizationId,
            loyverseVariants.organizationId,
          ),
          eq(
            loyverseItemSettings.variantExternalId,
            loyverseVariants.externalId,
          ),
        ),
      )
      .where(
        and(
          eq(loyverseVariants.organizationId, organizationId),
          eq(loyverseVariants.externalId, variantExternalId),
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
  ]);

  if (!item) return null;

  const sourceLevelQuery = db
    .select({
      storeExternalId: loyverseInventoryLevels.storeExternalId,
      inStock: loyverseInventoryLevels.inStock,
      syncedAt: loyverseInventoryLevels.syncedAt,
    })
    .from(loyverseInventoryLevels)
    .where(
      and(
        eq(loyverseInventoryLevels.organizationId, organizationId),
        eq(
          loyverseInventoryLevels.variantExternalId,
          variantExternalId,
        ),
        ...(balance?.loyverseStoreExternalId
          ? [
              eq(
                loyverseInventoryLevels.storeExternalId,
                balance.loyverseStoreExternalId,
              ),
            ]
          : []),
      ),
    )
    .limit(1);

  const [sourceLevel] = await sourceLevelQuery;
  const storeExternalId =
    balance?.loyverseStoreExternalId ??
    sourceLevel?.storeExternalId ??
    null;

  const [snapshots, movements] = await Promise.all([
    storeExternalId
      ? db
          .select({
            inStock: loyverseInventorySnapshots.inStock,
            capturedAt: loyverseInventorySnapshots.capturedAt,
          })
          .from(loyverseInventorySnapshots)
          .where(
            and(
              eq(
                loyverseInventorySnapshots.organizationId,
                organizationId,
              ),
              eq(
                loyverseInventorySnapshots.variantExternalId,
                variantExternalId,
              ),
              eq(
                loyverseInventorySnapshots.storeExternalId,
                storeExternalId,
              ),
              gte(loyverseInventorySnapshots.capturedAt, since),
            ),
          )
          .orderBy(asc(loyverseInventorySnapshots.capturedAt))
      : Promise.resolve([]),
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

  const soldByWeight = bool(item.payload.sold_by_weight);
  const configuredFactor =
    item.displayUnit && item.displayFactor != null
      ? Number(item.displayFactor)
      : 1;
  const displayFactor = Number.isFinite(configuredFactor)
    ? configuredFactor
    : 1;
  const displayUnit =
    item.displayUnit ?? (soldByWeight ? "unidad Loyverse" : "pz");
  const display = (value: number) => value * displayFactor;

  const sourcePoints = snapshots.map((snapshot) => ({
    at: snapshot.capturedAt,
    stockNative: Number(snapshot.inStock),
    stock: display(Number(snapshot.inStock)),
  }));

  if (sourcePoints.length === 0 && sourceLevel) {
    sourcePoints.push({
      at: sourceLevel.syncedAt,
      stockNative: Number(sourceLevel.inStock),
      stock: display(Number(sourceLevel.inStock)),
    });
  }

  let lastRestockAt: Date | null = null;
  const sourceChanges: Array<{
    at: Date;
    before: number;
    after: number;
    delta: number;
  }> = [];

  for (let index = 1; index < sourcePoints.length; index += 1) {
    const before = sourcePoints[index - 1];
    const after = sourcePoints[index];
    const delta = after.stockNative - before.stockNative;
    if (Math.abs(delta) < 0.0005) continue;

    sourceChanges.push({
      at: after.at,
      before: display(before.stockNative),
      after: display(after.stockNative),
      delta: display(delta),
    });

    if (delta > 0) lastRestockAt = after.at;
  }

  const daily = new Map(
    dateKeys(days).map((date) => [
      date,
      { date, consumption: 0, waste: 0 },
    ]),
  );

  let totalConsumptionNative = 0;
  for (const movement of movements) {
    const delta = Number(movement.quantityDeltaNative);
    if (delta >= 0) continue;
    if (!["SALE", "WASTE", "PRODUCTION_CONSUMPTION"].includes(
      movement.movementType,
    )) {
      continue;
    }

    const quantity = Math.abs(delta);
    totalConsumptionNative += quantity;
    const point = daily.get(dateKey(movement.occurredAt));
    if (!point) continue;
    point.consumption += display(quantity);
    if (movement.movementType === "WASTE") {
      point.waste += display(quantity);
    }
  }

  const sourceCurrentNative = sourceLevel
    ? Number(sourceLevel.inStock)
    : null;
  const operationalCurrentNative = balance
    ? Number(balance.quantityNative)
    : null;
  const sourceNetNative =
    sourcePoints.length >= 2
      ? sourcePoints.at(-1)!.stockNative - sourcePoints[0].stockNative
      : 0;

  return {
    item: {
      variantExternalId: item.variantExternalId,
      itemName: item.itemName,
      sku: item.sku,
      soldByWeight,
    },
    displayUnit,
    displayFactor,
    periodDays: days,
    source: {
      current:
        sourceCurrentNative == null
          ? null
          : display(sourceCurrentNative),
      syncedAt: sourceLevel?.syncedAt ?? null,
      points: sourcePoints.map((point) => ({
        at: point.at,
        stock: point.stock,
      })),
      changes: sourceChanges.sort(
        (a, b) => b.at.getTime() - a.at.getTime(),
      ),
      netChange: display(sourceNetNative),
      lastRestockAt,
      daysSinceLastRestock:
        lastRestockAt == null
          ? null
          : Math.max(
              0,
              Math.floor(
                (Date.now() - lastRestockAt.getTime()) / 86_400_000,
              ),
            ),
    },
    operational: {
      current:
        operationalCurrentNative == null
          ? null
          : display(operationalCurrentNative),
      initializedAt: balance?.initializedAt ?? null,
      updatedAt: balance?.updatedAt ?? null,
      sourceOpening:
        balance == null
          ? null
          : display(Number(balance.sourceQuantityNative)),
      driftVsSource:
        operationalCurrentNative == null || sourceCurrentNative == null
          ? null
          : display(operationalCurrentNative - sourceCurrentNative),
      totalConsumption: display(totalConsumptionNative),
      averageDailyConsumption:
        days > 0 ? display(totalConsumptionNative) / days : 0,
      daily: [...daily.values()],
      movements: movements.map((movement) => ({
        ...movement,
        quantityDelta: display(
          Number(movement.quantityDeltaNative),
        ),
      })),
    },
  };
}
