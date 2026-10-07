import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  operationalEvents,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
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

  const [[activeRoast], qcsToday, incidents] = await Promise.all([
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
      })
      .from(espressoQualityChecks)
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
  ]);

  const currentShift = local.hour < 16 ? "MORNING" : "AFTERNOON";
  const latestQc = qcsToday[0] ?? null;
  const qcPassedToday = qcsToday.filter(
    (row) => row.withinTimeSpec && row.withinYieldSpec === true,
  ).length;

  const shiftIngredients = inventory.smartRows
    .map((row) => {
      const expected =
        currentShift === "MORNING"
          ? row.expectedTodayMorning
          : row.expectedTodayAfternoon;
      return {
        variantExternalId: row.variantExternalId,
        itemName: row.itemName,
        unitLabel: row.unitLabel,
        inStock: row.inStock,
        expected,
        remainingAfterForecast: row.inStock - expected,
        status: row.status,
      };
    })
    .filter((row) => row.expected > 0.0005)
    .sort((a, b) => b.expected - a.expected)
    .slice(0, 10);

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
      unitLabel: row.unitLabel,
    }));

  const prepActions: Array<{
    priority: "ACTION" | "WATCH" | "INFO";
    title: string;
    detail: string;
    href?: string;
  }> = [];

  if (!latestQc) {
    prepActions.push({
      priority: "ACTION",
      title: "Calibrar espresso",
      detail: "Todavía no hay QC registrado hoy.",
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

  for (const risk of inventory.shift.risks.slice(0, 4)) {
    prepActions.push({
      priority: risk.status,
      title: "Reponer " + risk.itemName,
      detail:
        "Stock " +
        risk.inStock.toFixed(2) +
        " " +
        risk.unitLabel +
        " vs consumo esperado del turno " +
        risk.expectedShift.toFixed(2) +
        ".",
      href: "/inventory",
    });
  }

  if (inventory.shift.traffic.nextPeak) {
    const peak = inventory.shift.traffic.nextPeak;
    prepActions.push({
      priority: "INFO",
      title:
        "Preparar estación antes de " +
        String(peak.hour).padStart(2, "0") +
        ":00",
      detail:
        "Es la siguiente hora con mayor tráfico esperado para este día de la semana.",
    });
  }

  if (inventory.shift.topProducts.length > 0) {
    prepActions.push({
      priority: "INFO",
      title: "Priorizar mise en place",
      detail: inventory.shift.topProducts
        .slice(0, 4)
        .map(
          (row) =>
            row.name + " ≈ " + row.expected.toFixed(1),
        )
        .join(" · "),
    });
  }

  if (!activeRoast) {
    prepActions.push({
      priority: "WATCH",
      title: "Café espresso sin batch asignado",
      detail:
        "Los controles de espresso no podrán relacionarse con un tueste específico.",
    });
  }

  return {
    currentShift,
    sampleDays: inventory.shift.sampleDays,
    traffic: inventory.shift.traffic,
    topProducts: inventory.shift.topProducts,
    shiftRisks: inventory.shift.risks,
    shiftIngredients,
    unavailableProducts: inventory.unavailableProducts,
    activeRoast: activeRoast
      ? {
          ...activeRoast,
          ageDays: ageDays(activeRoast.roastedAt),
        }
      : null,
    latestQc,
    calibration: {
      attemptsToday: qcsToday.length,
      passedToday: qcPassedToday,
      passRate:
        qcsToday.length > 0
          ? (qcPassedToday / qcsToday.length) * 100
          : null,
    },
    prepActions: prepActions.slice(0, 8),
    incidents,
    wasteOptions,
  };
}
