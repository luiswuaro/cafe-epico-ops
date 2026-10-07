import { and, eq, gte } from "drizzle-orm";
import { getLoyverseInventoryView } from "@/src/application/loyverse/inventory-view";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseInventorySnapshots,
  loyverseItems,
  loyverseReceiptLines,
  loyverseReceipts,
  loyverseVariants,
} from "@/src/infrastructure/db/schema";

type UsageBucket = {
  total: number;
  morning: number;
  afternoon: number;
};

function bool(value: unknown) {
  return value === true || value === "true";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const part = (type: string) =>
    parts.find((row) => row.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    hour: Number(part("hour")),
  };
}

function tomorrowWeekday() {
  const tomorrow = new Date(Date.now() + 86_400_000);
  return localParts(tomorrow).weekday;
}

function currentLocalDay() {
  return localParts(new Date());
}

function addUsage(
  map: Map<string, UsageBucket>,
  variantId: string,
  quantity: number,
  shift: "morning" | "afternoon",
) {
  const row = map.get(variantId) ?? {
    total: 0,
    morning: 0,
    afternoon: 0,
  };
  row.total += quantity;
  row[shift] += quantity;
  map.set(variantId, row);
}

export async function getInventoryIntelligence(
  organizationId: string,
  preferredStoreExternalId?: string,
) {
  const db = getDb();
  const inventory = await getLoyverseInventoryView(
    organizationId,
    preferredStoreExternalId,
  );
  const selectedStore = inventory.selectedStore;

  if (!selectedStore) {
    return {
      ...inventory,
      smartRows: [],
      recentChanges: [],
      summary: {
        atRisk: 0,
        suggestedPurchases: 0,
        estimatedReplenishmentCost: 0,
        tomorrowSampleDays: 0,
      },
    };
  }

  const since35 = new Date(Date.now() - 35 * 86_400_000);
  const since14 = new Date(Date.now() - 14 * 86_400_000);

  const [items, variants, receipts, lines, snapshots] =
    await Promise.all([
      db
        .select({
          externalId: loyverseItems.externalId,
          itemName: loyverseItems.itemName,
          payload: loyverseItems.payload,
        })
        .from(loyverseItems)
        .where(eq(loyverseItems.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseVariants.externalId,
          loyverseItemExternalId: loyverseVariants.loyverseItemExternalId,
          sku: loyverseVariants.sku,
          payload: loyverseVariants.payload,
        })
        .from(loyverseVariants)
        .where(eq(loyverseVariants.organizationId, organizationId)),
      db
        .select({
          externalId: loyverseReceipts.externalId,
          receiptDate: loyverseReceipts.receiptDate,
        })
        .from(loyverseReceipts)
        .where(
          and(
            eq(loyverseReceipts.organizationId, organizationId),
            eq(loyverseReceipts.receiptType, "SALE"),
            eq(loyverseReceipts.storeExternalId, selectedStore.externalId),
            gte(loyverseReceipts.receiptDate, since35),
          ),
        ),
      db
        .select({
          receiptExternalId: loyverseReceiptLines.receiptExternalId,
          variantExternalId: loyverseReceiptLines.variantExternalId,
          quantity: loyverseReceiptLines.quantity,
        })
        .from(loyverseReceiptLines)
        .where(eq(loyverseReceiptLines.organizationId, organizationId)),
      db
        .select({
          variantExternalId: loyverseInventorySnapshots.variantExternalId,
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
              loyverseInventorySnapshots.storeExternalId,
              selectedStore.externalId,
            ),
            gte(loyverseInventorySnapshots.capturedAt, since35),
          ),
        ),
    ]);

  const itemById = new Map(
    items.map((item) => [item.externalId, item]),
  );
  const variantById = new Map(
    variants.map((variant) => [variant.externalId, variant]),
  );
  const receiptById = new Map(
    receipts.map((receipt) => [receipt.externalId, receipt]),
  );

  function components(payload: Record<string, unknown>) {
    const raw = payload.components;
    if (!Array.isArray(raw)) return [] as Array<{
      variantId: string;
      quantity: number;
    }>;

    return raw.flatMap((value) => {
      const row = asRecord(value);
      const variantId =
        typeof row.variant_id === "string" ? row.variant_id : "";
      const quantity = Number(row.quantity);
      if (!variantId || !Number.isFinite(quantity)) return [];
      return [{ variantId, quantity }];
    });
  }

  function expand(
    variantId: string,
    factor: number,
    out: Map<string, number>,
    path: Set<string>,
  ) {
    if (path.has(variantId)) return;

    const variant = variantById.get(variantId);
    const item = variant?.loyverseItemExternalId
      ? itemById.get(variant.loyverseItemExternalId)
      : undefined;

    if (!variant || !item) return;

    const children = components(item.payload);
    if (bool(item.payload.is_composite) && children.length > 0) {
      const nextPath = new Set(path);
      nextPath.add(variantId);
      for (const child of children) {
        expand(
          child.variantId,
          factor * child.quantity,
          out,
          nextPath,
        );
      }
      return;
    }

    if (!bool(item.payload.track_stock)) return;
    out.set(variantId, (out.get(variantId) ?? 0) + factor);
  }

  const usage14 = new Map<string, UsageBucket>();
  const usageByDate = new Map<string, Map<string, UsageBucket>>();
  const usageEvents = new Map<
    string,
    Array<{ at: Date; quantity: number }>
  >();
  const currentDay = currentLocalDay();
  const tomorrowDay = tomorrowWeekday();
  const matchingDates = new Set<string>();
  const todayMatchingDates = new Set<string>();

  for (const line of lines) {
    if (!line.variantExternalId) continue;
    const receipt = receiptById.get(line.receiptExternalId);
    if (!receipt?.receiptDate) continue;

    const local = localParts(receipt.receiptDate);
    const shift =
      local.hour < 16 ? ("morning" as const) : ("afternoon" as const);
    const expanded = new Map<string, number>();
    expand(
      line.variantExternalId,
      Number(line.quantity),
      expanded,
      new Set(),
    );

    if (receipt.receiptDate >= since14) {
      for (const [variantId, quantity] of expanded) {
        addUsage(usage14, variantId, quantity, shift);
      }
    }

    const dayMap = usageByDate.get(local.date) ?? new Map();
    for (const [variantId, quantity] of expanded) {
      addUsage(dayMap, variantId, quantity, shift);
      const events = usageEvents.get(variantId) ?? [];
      events.push({ at: receipt.receiptDate, quantity });
      usageEvents.set(variantId, events);
    }
    usageByDate.set(local.date, dayMap);

    if (local.weekday === tomorrowDay) {
      matchingDates.add(local.date);
    }
    if (
      local.weekday === currentDay.weekday &&
      local.date !== currentDay.date
    ) {
      todayMatchingDates.add(local.date);
    }
  }

  function averageUsageForDates(dates: Set<string>) {
    const result = new Map<string, UsageBucket>();
    for (const date of dates) {
      const day = usageByDate.get(date);
      if (!day) continue;
      for (const [variantId, usage] of day) {
        const current = result.get(variantId) ?? {
          total: 0,
          morning: 0,
          afternoon: 0,
        };
        current.total += usage.total;
        current.morning += usage.morning;
        current.afternoon += usage.afternoon;
        result.set(variantId, current);
      }
    }

    if (dates.size > 0) {
      for (const usage of result.values()) {
        usage.total /= dates.size;
        usage.morning /= dates.size;
        usage.afternoon /= dates.size;
      }
    }
    return result;
  }

  const tomorrowUsage = averageUsageForDates(matchingDates);
  const todayUsage = averageUsageForDates(todayMatchingDates);
  const tomorrowSamples = matchingDates.size;
  const todaySamples = todayMatchingDates.size;

  const inventoryByVariant = new Map(
    inventory.rows.map((row) => [row.variantExternalId, row]),
  );

  const smartRows = inventory.rows
    .map((row) => {
      const recent = usage14.get(row.variantExternalId) ?? {
        total: 0,
        morning: 0,
        afternoon: 0,
      };
      const avgDaily = recent.total / 14;
      const fallbackForecast = {
        total: avgDaily,
        morning: recent.morning / 14,
        afternoon: recent.afternoon / 14,
      };
      const tomorrow = tomorrowUsage.get(row.variantExternalId);
      const forecast =
        tomorrowSamples >= 2 && tomorrow
          ? tomorrow
          : fallbackForecast;
      const today = todayUsage.get(row.variantExternalId);
      const todayForecast =
        todaySamples >= 2 && today ? today : fallbackForecast;

      const daysCover =
        avgDaily > 0 ? Math.max(0, row.inStock) / avgDaily : null;
      const planningDays = Math.max(
        7,
        row.leadDays + row.safetyDays + 2,
      );
      const targetStock =
        row.optimalStock != null && row.optimalStock > 0
          ? row.optimalStock
          : Math.max(avgDaily * planningDays, row.lowStock ?? 0);
      const rawSuggestedPurchase = Math.max(
        0,
        targetStock - Math.max(0, row.inStock),
      );
      const suggestedPackages =
        row.packageQuantityNative != null &&
        row.packageQuantityNative > 0 &&
        rawSuggestedPurchase > 0
          ? Math.ceil(
              rawSuggestedPurchase / row.packageQuantityNative,
            )
          : null;
      const suggestedPurchase =
        suggestedPackages != null && row.packageQuantityNative != null
          ? suggestedPackages * row.packageQuantityNative
          : rawSuggestedPurchase;
      const suggestedCost =
        suggestedPackages != null && row.packagePrice != null
          ? suggestedPackages * row.packagePrice
          : row.purchaseCost != null
            ? suggestedPurchase * row.purchaseCost
            : null;
      const orderInDays =
        daysCover == null
          ? null
          : Math.max(
              0,
              Math.floor(
                daysCover - row.leadDays - row.safetyDays,
              ),
            );
      const orderDate =
        orderInDays == null
          ? null
          : new Date(
              Date.now() + orderInDays * 86_400_000,
            ).toISOString().slice(0, 10);

      const status =
        avgDaily <= 0
          ? ("NO_DATA" as const)
          : row.inStock <= 0 || (daysCover != null && daysCover < 1.5)
            ? ("CRITICAL" as const)
            : row.low || (daysCover != null && daysCover < 3)
              ? ("WATCH" as const)
              : ("OK" as const);

      return {
        ...row,
        avgDailyUsage14: avgDaily,
        daysCover,
        expectedTomorrow: forecast.total,
        expectedTomorrowMorning: forecast.morning,
        expectedTomorrowAfternoon: forecast.afternoon,
        expectedToday: todayForecast.total,
        expectedTodayMorning: todayForecast.morning,
        expectedTodayAfternoon: todayForecast.afternoon,
        planningDays,
        suggestedPurchase,
        suggestedPackages,
        suggestedCost,
        orderInDays,
        orderDate,
        status,
      };
    })
    .sort((a, b) => {
      const rank = {
        CRITICAL: 0,
        WATCH: 1,
        OK: 2,
        NO_DATA: 3,
      } as const;
      const byStatus = rank[a.status] - rank[b.status];
      if (byStatus !== 0) return byStatus;
      return a.itemName.localeCompare(b.itemName, "es");
    });

  const snapshotGroups = new Map<
    string,
    Array<{ stock: number; at: Date }>
  >();
  for (const snapshot of snapshots) {
    const list = snapshotGroups.get(snapshot.variantExternalId) ?? [];
    list.push({
      stock: Number(snapshot.inStock),
      at: snapshot.capturedAt,
    });
    snapshotGroups.set(snapshot.variantExternalId, list);
  }

  const recentChanges: Array<{
    variantExternalId: string;
    itemName: string;
    unitLabel: string;
    before: number;
    after: number;
    delta: number;
    capturedAt: Date;
  }> = [];

  for (const [variantId, rows] of snapshotGroups) {
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let index = 1; index < rows.length; index++) {
      const before = rows[index - 1];
      const after = rows[index];
      const delta = after.stock - before.stock;
      if (Math.abs(delta) < 0.0005) continue;
      const item = inventoryByVariant.get(variantId);
      recentChanges.push({
        variantExternalId: variantId,
        itemName: item?.itemName ?? variantId,
        unitLabel: item?.unitLabel ?? "u.",
        before: before.stock,
        after: after.stock,
        delta,
        capturedAt: after.at,
      });
    }
  }

  recentChanges.sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
  );

  const anomalyRows: Array<{
    variantExternalId: string;
    itemName: string;
    unitLabel: string;
    before: number;
    after: number;
    actualConsumption: number;
    expectedConsumption: number;
    variance: number;
    variancePct: number | null;
    from: Date;
    to: Date;
    severity: "WATCH" | "ACTION";
  }> = [];

  for (const [variantId, rows] of snapshotGroups) {
    const ordered = [...rows].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    if (ordered.length < 2) continue;

    const after = ordered.at(-1)!;
    const before = ordered.at(-2)!;
    const intervalHours =
      (after.at.getTime() - before.at.getTime()) / 3_600_000;
    if (intervalHours < 0.5 || intervalHours > 24 * 7) continue;

    const expectedConsumption = (usageEvents.get(variantId) ?? [])
      .filter(
        (event) =>
          event.at > before.at &&
          event.at <= after.at,
      )
      .reduce((sum, event) => sum + event.quantity, 0);
    const actualConsumption = before.stock - after.stock;
    const variance = actualConsumption - expectedConsumption;

    const significanceFloor = Math.max(
      0.25,
      expectedConsumption * 0.2,
    );
    if (variance <= significanceFloor) continue;

    const item = inventoryByVariant.get(variantId);
    const variancePct =
      expectedConsumption > 0
        ? (variance / expectedConsumption) * 100
        : null;

    anomalyRows.push({
      variantExternalId: variantId,
      itemName: item?.itemName ?? variantId,
      unitLabel: item?.unitLabel ?? "u.",
      before: before.stock,
      after: after.stock,
      actualConsumption,
      expectedConsumption,
      variance,
      variancePct,
      from: before.at,
      to: after.at,
      severity:
        variance >= Math.max(1, expectedConsumption * 0.5)
          ? "ACTION"
          : "WATCH",
    });
  }

  anomalyRows.sort(
    (a, b) =>
      (a.severity === "ACTION" ? 0 : 1) -
        (b.severity === "ACTION" ? 0 : 1) ||
      b.variance - a.variance,
  );

  const outOfStockVariantIds = new Set(
    smartRows
      .filter((row) => row.inStock <= 0)
      .map((row) => row.variantExternalId),
  );

  function leafDependencies(
    variantId: string,
    path = new Set<string>(),
  ): Set<string> {
    if (path.has(variantId)) return new Set();
    const variant = variantById.get(variantId);
    const item = variant?.loyverseItemExternalId
      ? itemById.get(variant.loyverseItemExternalId)
      : undefined;
    if (!variant || !item) return new Set();

    const children = components(item.payload);
    if (bool(item.payload.is_composite) && children.length > 0) {
      const next = new Set(path);
      next.add(variantId);
      const result = new Set<string>();
      for (const child of children) {
        for (const leaf of leafDependencies(child.variantId, next)) {
          result.add(leaf);
        }
      }
      return result;
    }

    return bool(item.payload.track_stock)
      ? new Set([variantId])
      : new Set();
  }

  const unavailableProducts = variants.flatMap((variant) => {
    if (!variant.loyverseItemExternalId) return [];
    const item = itemById.get(variant.loyverseItemExternalId);
    if (!item || !bool(item.payload.is_composite)) return [];
    if (item.payload.available_for_sale === false) return [];

    const leaves = leafDependencies(variant.externalId);
    const blockers = [...leaves].filter((id) =>
      outOfStockVariantIds.has(id),
    );
    if (blockers.length === 0) return [];

    return [{
      variantExternalId: variant.externalId,
      itemName: item.itemName,
      blockers: blockers.map(
        (id) => inventoryByVariant.get(id)?.itemName ?? id,
      ),
    }];
  });

  const currentShift =
    currentDay.hour < 16 ? ("MORNING" as const) : ("AFTERNOON" as const);
  const shiftRisks = smartRows
    .flatMap((row) => {
      const expected =
        currentShift === "MORNING"
          ? row.expectedTodayMorning
          : row.expectedTodayAfternoon;
      if (expected <= 0) return [];
      const ratio = row.inStock / expected;
      if (ratio >= 1.25) return [];
      return [{
        variantExternalId: row.variantExternalId,
        itemName: row.itemName,
        unitLabel: row.unitLabel,
        inStock: row.inStock,
        expectedShift: expected,
        coverageRatio: ratio,
        status:
          ratio < 1 ? ("ACTION" as const) : ("WATCH" as const),
      }];
    })
    .sort((a, b) => a.coverageRatio - b.coverageRatio);

  const suggested = smartRows.filter(
    (row) => row.suggestedPurchase > 0.0005,
  );

  return {
    ...inventory,
    smartRows,
    recentChanges: recentChanges.slice(0, 20),
    summary: {
      atRisk: smartRows.filter(
        (row) => row.status === "CRITICAL" || row.status === "WATCH",
      ).length,
      suggestedPurchases: suggested.length,
      estimatedReplenishmentCost: suggested.reduce(
        (sum, row) => sum + (row.suggestedCost ?? 0),
        0,
      ),
      tomorrowSampleDays: tomorrowSamples,
      todaySampleDays: todaySamples,
      anomalies: anomalyRows.length,
      unavailableProducts: unavailableProducts.length,
      shiftRisks: shiftRisks.length,
    },
    anomalies: anomalyRows.slice(0, 20),
    unavailableProducts: unavailableProducts
      .filter(
        (row, index, array) =>
          array.findIndex(
            (candidate) => candidate.itemName === row.itemName,
          ) === index,
      )
      .slice(0, 30),
    shift: {
      current: currentShift,
      sampleDays: todaySamples,
      risks: shiftRisks.slice(0, 12),
    },
  };
}
