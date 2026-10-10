import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
} from "drizzle-orm";
import { getOpsInventoryIntelligence } from "@/src/application/inventory/ops-intelligence";
import { getPosReadiness } from "@/src/application/pos/readiness";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
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
  const [inventory, readiness] = await Promise.all([
    getOpsInventoryIntelligence(employee.organizationId, employee.homeStoreId),
    getPosReadiness(employee.organizationId, employee.homeStoreId),
  ]);
  const opsByVariant=new Map(inventory.smartRows.map(row=>[row.variantExternalId,{
    variantExternalId:row.variantExternalId,name:row.itemName,unit:row.unitLabel,
    quantity:row.inStock,factor:1,minimumStock:row.minimumStock,
  }]));


  const local = localParts();
  const dayStart = new Date(local.date + "T00:00:00-06:00");

  const [
    [activeRoast],
    qcsToday,
    incidents,
    barEventsToday,
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
      event.note?.startsWith("Conteo físico OPS") &&
      event.variantExternalId &&
      !latestCountByVariant.has(event.variantExternalId)
    ) {
      latestCountByVariant.set(event.variantExternalId, event);
    }
  }

  const shiftRisks = inventory.smartRows.flatMap((row) => {
    const stock = opsByVariant.get(row.variantExternalId);
    if (!stock) return []; // Jamás usar el saldo de Loyverse como respaldo.
    const expectedNative = currentShift === "MORNING"
      ? row.expectedTodayMorning : row.expectedTodayAfternoon;
    const expected = expectedNative * stock.factor;
    if (expected <= 0) return [];
    const available = Math.max(0, stock.quantity);
    const ratio = available / expected;
    if (ratio >= 1.25 && stock.quantity >= 0) return [];
    return [{
      variantExternalId: row.variantExternalId,
      itemName: stock.name,
      unitLabel: stock.unit,
      displayUnit: stock.unit,
      displayFactor: 1,
      inStock: stock.quantity,
      operationalStock: available,
      inventoryNeedsCorrection: stock.quantity < 0,
      expectedShift: expected,
      shortage: Math.max(0, expected - available),
      coverageRatio: ratio,
      status: (stock.quantity < 0 || ratio < 1 ? "ACTION" : "WATCH") as "ACTION" | "WATCH",
      countedToday: latestCountByVariant.has(row.variantExternalId),
    }];
  }).sort((a, b) =>
    (a.status === "ACTION" ? 0 : 1) - (b.status === "ACTION" ? 0 : 1)
      || b.expectedShift - a.expectedShift
  ).slice(0, 12);

  const shiftIngredients = inventory.smartRows.flatMap((row) => {
    const stock = opsByVariant.get(row.variantExternalId);
    if (!stock) return [];
    const expectedNative = currentShift === "MORNING"
      ? row.expectedTodayMorning : row.expectedTodayAfternoon;
    const expected = expectedNative * stock.factor;
    if (expected <= 0.0005) return [];
    const available = Math.max(0, stock.quantity);
    return [{
      variantExternalId: row.variantExternalId,
      itemName: stock.name,
      unitLabel: stock.unit,
      soldByWeight: stock.unit !== "pz",
      inStock: available,
      sourceInStock: stock.quantity,
      expected,
      prepQuantity: stock.unit === "pz" ? Math.ceil(expected) : expected,
      remainingAfterForecast: available - expected,
      inventoryNeedsCorrection: stock.quantity < 0,
      countedToday: latestCountByVariant.has(row.variantExternalId),
      status: row.status,
    }];
  }).sort((a, b) => b.expected - a.expected).slice(0, 20);

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

  // Contar sólo los insumos confirmados en OPS. No sugerir la leche de
  // almendras, que aún no está dada de alta en este inventario.
  const countOptions = [...opsByVariant.values()].map((stock) => {
    const latestCount = latestCountByVariant.get(stock.variantExternalId);
    return {
      variantExternalId: stock.variantExternalId,
      itemName: stock.name,
      unitLabel: stock.unit,
      soldByWeight: stock.unit !== "pz",
      sourceQuantity: stock.quantity,
      countedToday: Boolean(latestCount),
      latestCountQuantity: latestCount?.displayQuantity == null
        ? null : Number(latestCount.displayQuantity),
      pendingAdmin: latestCount != null && latestCount.resolvedAt == null,
      status: stock.quantity <= 0 ? "CRITICAL"
        : stock.minimumStock !== null && stock.quantity < stock.minimumStock
          ? "WATCH" : "OK",
    };
  }).sort((a,b) => {
    const rank = (status:string) => status === "CRITICAL" ? 0 : status === "WATCH" ? 1 : 2;
    return rank(a.status)-rank(b.status) || a.itemName.localeCompare(b.itemName,"es");
  });

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
    const eventHasHumanUnit =
      event.displayUnit != null &&
      event.displayUnit !== "peso/volumen" &&
      event.displayUnit !== "u. Loyverse";
    const eventDisplayUnit = eventHasHumanUnit
      ? event.displayUnit!
      : row
        ? displayUnit(row)
        : event.unitLabel ?? "u.";
    const eventDisplayQuantity =
      eventHasHumanUnit && event.displayQuantity != null
        ? Number(event.displayQuantity)
        : Number(event.quantity ?? 0) * (row?.displayFactor ?? 1);
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
      eventDisplayUnit;
    const current = lossByItem.get(key) ?? {
      itemName:
        event.itemName ?? event.variantExternalId ?? "Sin identificar",
      displayUnit: eventDisplayUnit,
      displayQuantity: 0,
      events: 0,
      remakes: 0,
      estimatedCost: 0,
    };
    current.displayQuantity += eventDisplayQuantity;
    current.events += 1;
    current.remakes += event.eventType === "REMAKE" ? 1 : 0;
    current.estimatedCost += eventCost;
    lossByItem.set(key, current);
  }

  const soldUnitsToday = inventory.todaySoldUnits;
  const remakeRate =
    soldUnitsToday > 0
      ? (remakeEvents.length / soldUnitsToday) * 100
      : null;

  const stockCountsToday = [...latestCountByVariant.values()]
    .map((event) => {
      const stock = event.variantExternalId
        ? opsByVariant.get(event.variantExternalId) : null;
      const currentSource = stock?.quantity ?? null;
      const physical = event.displayQuantity == null
        ? null : Number(event.displayQuantity);
      return {
        id: event.id,
        variantExternalId: event.variantExternalId,
        itemName: stock?.name ?? event.itemName ?? "Insumo",
        displayUnit: stock?.unit ?? event.displayUnit ?? event.unitLabel ?? "u.",
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

  const negativeRows = [...opsByVariant.values()].filter(
    (row) => row.quantity < 0,
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
    unavailableProducts: readiness.products.flatMap((product) => {
      const blockers = [...new Set(product.recipes.flatMap(recipe =>
        recipe.errors
          .filter(error => /^(Sin existencias:|Sin saldo inicial:|Sin equivalencia:|Equivalencia duplicada:)/.test(error))
          .map(error => error.replace(/^[^:]+:\s*/, ""))
      ))];
      return blockers.length ? [{
        variantExternalId: product.id,
        itemName: product.name,
        blockers,
        recentQty: 0,
      }] : [];
    }),
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
