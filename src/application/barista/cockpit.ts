import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
} from "drizzle-orm";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  loyverseReceiptLines,
  loyverseReceipts,
  operationalEvents,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
  recipes,
  recipeVersions,
} from "@/src/infrastructure/db/schema";

function localParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

function ageDays(date: Date) {
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

export async function getBaristaCockpit(employee: {
  id: string;
  organizationId: string;
  homeStoreId: string | null;
}) {
  if (!employee.homeStoreId) throw new Error("Employee has no home store");

  const db = getDb();
  const inventory = await getInventoryIntelligence(employee.organizationId);
  const local = localParts();
  const dayStart = new Date(local.date + "T00:00:00-06:00");
  const loyverseStoreExternalId = inventory.selectedStore?.externalId ?? "";

  const [
    [activeRoast],
    qcsToday,
    incidents,
    barEventsToday,
    soldRowsToday,
  ] = await Promise.all([
    db
      .select({
        batchId: roastBatches.id,
        batchCode: roastBatches.batchCode,
        roastedAt: roastBatches.roastedAt,
        lotName: roastCoffeeLots.name,
      })
      .from(roastBarAssignments)
      .innerJoin(
        roastBatches,
        eq(roastBatches.id, roastBarAssignments.roastBatchId),
      )
      .innerJoin(
        roastCoffeeLots,
        eq(roastCoffeeLots.id, roastBatches.coffeeLotId),
      )
      .where(
        and(
          eq(
            roastBarAssignments.organizationId,
            employee.organizationId,
          ),
          eq(roastBarAssignments.storeId, employee.homeStoreId),
          eq(roastBarAssignments.barRole, "ESPRESSO"),
          eq(roastBarAssignments.isActive, true),
        ),
      )
      .orderBy(desc(roastBarAssignments.startedAt))
      .limit(1),
    db
      .select({
        id: espressoQualityChecks.id,
        brewTimeS: espressoQualityChecks.brewTimeS,
        doseG: espressoQualityChecks.doseG,
        yieldG: espressoQualityChecks.yieldG,
        withinTimeSpec: espressoQualityChecks.withinTimeSpec,
        withinYieldSpec: espressoQualityChecks.withinYieldSpec,
        sensoryRating: espressoQualityChecks.sensoryRating,
        createdAt: espressoQualityChecks.createdAt,
        recipeName: recipes.name,
      })
      .from(espressoQualityChecks)
      .leftJoin(
        recipeVersions,
        eq(recipeVersions.id, espressoQualityChecks.recipeVersionId),
      )
      .leftJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
      .where(
        and(
          eq(
            espressoQualityChecks.organizationId,
            employee.organizationId,
          ),
          eq(espressoQualityChecks.storeId, employee.homeStoreId),
          gte(espressoQualityChecks.createdAt, dayStart),
        ),
      )
      .orderBy(desc(espressoQualityChecks.createdAt))
      .limit(30),
    db
      .select({
        id: operationalEvents.id,
        severity: operationalEvents.severity,
        area: operationalEvents.itemNameSnapshot,
        note: operationalEvents.note,
        occurredAt: operationalEvents.occurredAt,
      })
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.organizationId, employee.organizationId),
          eq(operationalEvents.storeId, employee.homeStoreId),
          eq(operationalEvents.eventType, "BAR_INCIDENT"),
          isNull(operationalEvents.resolvedAt),
        ),
      )
      .orderBy(desc(operationalEvents.occurredAt))
      .limit(5),
    db
      .select({
        id: operationalEvents.id,
        eventType: operationalEvents.eventType,
        severity: operationalEvents.severity,
        variantExternalId: operationalEvents.variantExternalId,
        itemName: operationalEvents.itemNameSnapshot,
        quantity: operationalEvents.quantity,
        unitLabel: operationalEvents.unitLabel,
        displayQuantity: operationalEvents.displayQuantity,
        displayUnit: operationalEvents.displayUnit,
        note: operationalEvents.note,
        occurredAt: operationalEvents.occurredAt,
        resolvedAt: operationalEvents.resolvedAt,
      })
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.organizationId, employee.organizationId),
          eq(operationalEvents.storeId, employee.homeStoreId),
          inArray(operationalEvents.eventType, [
            "WASTE",
            "REMAKE",
            "STOCK_COUNT",
          ]),
          gte(operationalEvents.occurredAt, dayStart),
        ),
      )
      .orderBy(desc(operationalEvents.occurredAt))
      .limit(150),
    loyverseStoreExternalId
      ? db
          .select({
            quantity: loyverseReceiptLines.quantity,
          })
          .from(loyverseReceiptLines)
          .innerJoin(
            loyverseReceipts,
            and(
              eq(
                loyverseReceipts.organizationId,
                loyverseReceiptLines.organizationId,
              ),
              eq(
                loyverseReceipts.externalId,
                loyverseReceiptLines.receiptExternalId,
              ),
            ),
          )
          .where(
            and(
              eq(
                loyverseReceipts.organizationId,
                employee.organizationId,
              ),
              eq(loyverseReceipts.receiptType, "SALE"),
              eq(
                loyverseReceipts.storeExternalId,
                loyverseStoreExternalId,
              ),
              gte(loyverseReceipts.receiptDate, dayStart),
            ),
          )
      : Promise.resolve([]),
  ]);

  const currentShift = local.hour < 16 ? "MORNING" : "AFTERNOON";
  const standardEspressoQcs = qcsToday.filter(
    (row) => row.recipeName === "Espresso base 1:2",
  );
  const latestQc = standardEspressoQcs[0] ?? null;
  const latestAnyQc = qcsToday[0] ?? null;
  const qcPassedToday = standardEspressoQcs.filter(
    (row) => row.withinTimeSpec && row.withinYieldSpec === true,
  ).length;

  const displayUnit = (row: {
    displayUnit?: string | null;
    unitLabel: string;
  }) =>
    row.displayUnit ??
    (row.unitLabel === "peso/volumen" ? "u. Loyverse" : row.unitLabel);

  const displayQuantity = (
    row: { displayFactor?: number | null },
    value: number,
  ) => value * (row.displayFactor ?? 1);

  const latestCountByVariant = new Map<
    string,
    (typeof barEventsToday)[number]
  >();
  for (const event of barEventsToday) {
    if (
      event.eventType === "STOCK_COUNT" &&
      event.variantExternalId &&
      !latestCountByVariant.has(event.variantExternalId)
    ) {
      latestCountByVariant.set(event.variantExternalId, event);
    }
  }

  const shiftRisks = inventory.shift.risks.map((risk) => ({
    ...risk,
    countedToday: latestCountByVariant.has(risk.variantExternalId),
  }));

  const shiftIngredients = inventory.smartRows
    .map((row) => {
      const expected =
        currentShift === "MORNING"
          ? row.expectedTodayMorning
          : row.expectedTodayAfternoon;
      const factor = row.displayFactor ?? 1;
      return {
        variantExternalId: row.variantExternalId,
        itemName: row.itemName,
        unitLabel: displayUnit(row),
        soldByWeight: row.soldByWeight,
        inStock: displayQuantity(row, Math.max(0, row.inStock)),
        sourceInStock: displayQuantity(row, row.inStock),
        expected: expected * factor,
        prepQuantity: row.soldByWeight
          ? expected * factor
          : Math.ceil(expected * factor),
        remainingAfterForecast:
          (Math.max(0, row.inStock) - expected) * factor,
        inventoryNeedsCorrection: row.inStock < 0,
        countedToday: latestCountByVariant.has(row.variantExternalId),
        status: row.status,
      };
    })
    .filter((row) => row.expected > 0.0005)
    .sort((a, b) => b.expected - a.expected)
    .slice(0, 20);

  const wasteOptions = inventory.smartRows
    .filter((row) => row.inStock > 0 || row.avgDailyUsage14 > 0)
    .sort(
      (a, b) =>
        b.avgDailyUsage14 - a.avgDailyUsage14 ||
        a.itemName.localeCompare(b.itemName, "es"),
    )
    .slice(0, 60)
    .map((row) => ({
      variantExternalId: row.variantExternalId,
      itemName: row.itemName,
      unitLabel: displayUnit(row),
      displayFactor: row.displayFactor ?? 1,
    }));

  const countOptions = inventory.smartRows
    .map((row) => {
      const factor = row.displayFactor ?? 1;
      const latestCount = latestCountByVariant.get(row.variantExternalId);
      return {
        variantExternalId: row.variantExternalId,
        itemName: row.itemName,
        unitLabel: displayUnit(row),
        soldByWeight: row.soldByWeight,
        sourceQuantity: row.inStock * factor,
        countedToday: Boolean(latestCount),
        latestCountQuantity:
          latestCount?.displayQuantity == null
            ? null
            : Number(latestCount.displayQuantity),
        pendingAdmin:
          latestCount != null && latestCount.resolvedAt == null,
        status: row.status,
      };
    })
    .sort((a, b) => {
      const aRank =
        a.sourceQuantity < 0
          ? 0
          : a.status === "CRITICAL"
            ? 1
            : a.status === "WATCH"
              ? 2
              : 3;
      const bRank =
        b.sourceQuantity < 0
          ? 0
          : b.status === "CRITICAL"
            ? 1
            : b.status === "WATCH"
              ? 2
              : 3;
      return aRank - bRank || a.itemName.localeCompare(b.itemName, "es");
    })
    .slice(0, 80);

  const lossEvents = barEventsToday.filter(
    (event) => event.eventType === "WASTE" || event.eventType === "REMAKE",
  );
  const wasteEvents = lossEvents.filter(
    (event) => event.eventType === "WASTE",
  );
  const remakeEvents = lossEvents.filter(
    (event) => event.eventType === "REMAKE",
  );
  const smartByVariant = new Map(
    inventory.smartRows.map((row) => [row.variantExternalId, row]),
  );

  let estimatedLossCost = 0;
  let estimatedWasteCost = 0;
  let estimatedRemakeCost = 0;
  let costedLossEvents = 0;
  const lossByItem = new Map<
    string,
    {
      itemName: string;
      displayUnit: string;
      displayQuantity: number;
      events: number;
      remakes: number;
      estimatedCost: number;
    }
  >();

  for (const event of lossEvents) {
    const row = event.variantExternalId
      ? smartByVariant.get(event.variantExternalId)
      : null;
    const unitCost = row?.purchaseCost ?? null;
    const nativeQuantity = Number(event.quantity ?? 0);
    const eventCost =
      unitCost != null && Number.isFinite(nativeQuantity)
        ? nativeQuantity * unitCost
        : 0;

    if (unitCost != null && Number.isFinite(nativeQuantity)) {
      estimatedLossCost += eventCost;
      if (event.eventType === "REMAKE") {
        estimatedRemakeCost += eventCost;
      } else {
        estimatedWasteCost += eventCost;
      }
      costedLossEvents += 1;
    }

    const key =
      (event.itemName ?? event.variantExternalId ?? "Sin identificar") +
      "::" +
      (event.displayUnit ?? event.unitLabel ?? "u.");
    const current = lossByItem.get(key) ?? {
      itemName:
        event.itemName ?? event.variantExternalId ?? "Sin identificar",
      displayUnit: event.displayUnit ?? event.unitLabel ?? "u.",
      displayQuantity: 0,
      events: 0,
      remakes: 0,
      estimatedCost: 0,
    };
    current.displayQuantity += Number(
      event.displayQuantity ?? event.quantity ?? 0,
    );
    current.events += 1;
    current.remakes += event.eventType === "REMAKE" ? 1 : 0;
    current.estimatedCost += eventCost;
    lossByItem.set(key, current);
  }

  const soldUnitsToday = soldRowsToday.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const remakeRate =
    soldUnitsToday > 0
      ? (remakeEvents.length / soldUnitsToday) * 100
      : null;

  const stockCountsToday = [...latestCountByVariant.values()]
    .map((event) => {
      const row = event.variantExternalId
        ? smartByVariant.get(event.variantExternalId)
        : null;
      const factor = row?.displayFactor ?? 1;
      const currentSource =
        row == null ? null : row.inStock * factor;
      const physical =
        event.displayQuantity == null
          ? null
          : Number(event.displayQuantity);
      return {
        id: event.id,
        variantExternalId: event.variantExternalId,
        itemName: event.itemName ?? "Insumo",
        displayUnit:
          event.displayUnit ??
          (row ? displayUnit(row) : event.unitLabel ?? "u."),
        physicalQuantity: physical,
        sourceQuantity: currentSource,
        difference:
          physical == null || currentSource == null
            ? null
            : physical - currentSource,
        pendingAdmin: event.resolvedAt == null,
        occurredAt: event.occurredAt,
      };
    })
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 8);

  const negativeRows = inventory.smartRows.filter(
    (row) => row.inStock < 0,
  );
  const inventoryCorrectionPending = negativeRows.filter(
    (row) => !latestCountByVariant.has(row.variantExternalId),
  ).length;
  const inventoryCorrectionSubmitted = negativeRows.length -
    inventoryCorrectionPending;

  const prepActions: Array<{
    priority: "ACTION" | "WATCH" | "INFO";
    title: string;
    detail: string;
    href?: string;
  }> = [];

  if (!latestQc) {
    prepActions.push({
      priority: "ACTION",
      title: "Calibrar espresso base 1:2",
      detail:
        latestAnyQc
          ? "Hay controles de otras extracciones hoy, pero falta confirmar el espresso estándar de barra."
          : "Todavía no hay QC del espresso estándar registrado hoy.",
      href: "/quality/espresso",
    });
  } else if (
    !latestQc.withinTimeSpec ||
    latestQc.withinYieldSpec !== true
  ) {
    prepActions.push({
      priority: "ACTION",
      title: "Repetir calibración",
      detail:
        "El último control quedó fuera de especificación. Corrige una variable a la vez y vuelve a medir.",
      href: "/quality/espresso",
    });
  }

  return {
    currentShift,
    currentHour: local.hour,
    sampleDays: inventory.shift.sampleDays,
    traffic: inventory.shift.traffic,
    topProducts: inventory.shift.topProducts,
    shiftRisks,
    shiftIngredients,
    prepConsumables: shiftIngredients
      .filter((row) => !row.soldByWeight)
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 8),
    prepIngredients: shiftIngredients
      .filter((row) => row.soldByWeight)
      .sort((a, b) => b.expected - a.expected)
      .slice(0, 8),
    unavailableProducts: inventory.unavailableProducts,
    activeRoast: activeRoast
      ? {
          ...activeRoast,
          ageDays: ageDays(activeRoast.roastedAt),
        }
      : null,
    latestQc,
    calibration: {
      attemptsToday: standardEspressoQcs.length,
      passedToday: qcPassedToday,
      passRate:
        standardEspressoQcs.length > 0
          ? (qcPassedToday / standardEspressoQcs.length) * 100
          : null,
    },
    prepActions: prepActions.slice(0, 8),
    inventoryCorrectionCount: inventoryCorrectionPending,
    inventoryCorrectionSubmitted,
    incidents,
    wasteOptions,
    countOptions,
    stockCountsToday,
    lossSummary: {
      wasteEvents: wasteEvents.length,
      remakeEvents: remakeEvents.length,
      soldUnitsToday,
      remakeRate,
      estimatedLossCost,
      estimatedWasteCost,
      estimatedRemakeCost,
      costedLossEvents,
      totalLossEvents: lossEvents.length,
      topLosses: [...lossByItem.values()]
        .sort(
          (a, b) =>
            b.estimatedCost - a.estimatedCost ||
            b.events - a.events,
        )
        .slice(0, 6),
    },
  };
}
