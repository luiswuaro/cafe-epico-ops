import { and, desc, eq, isNull } from "drizzle-orm";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  operationalEvents,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
} from "@/src/infrastructure/db/schema";

function localHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
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

  const [[activeRoast], [latestQc], incidents] = await Promise.all([
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
        ),
      )
      .orderBy(desc(espressoQualityChecks.createdAt))
      .limit(1),
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

  const hour = localHour();
  const currentShift = hour < 16 ? "MORNING" : "AFTERNOON";

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
    latestQc: latestQc ?? null,
    incidents,
    wasteOptions,
  };
}
