import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { countOpenShortages } from "@/src/application/inventory/shortages";
import { getUnreadEmployeeMessages } from "@/src/application/messages/read";
import { getOpsInventoryIntelligence } from "@/src/application/inventory/ops-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
  operationalEvents,
  roastBarAssignments,
  roastBatches,
  roastCoffeeLots,
  stores,
} from "@/src/infrastructure/db/schema";

export async function getTodayOperationalSummary(employee: {
  id: string;
  organizationId: string;
  homeStoreId: string | null;
}) {
  if (!employee.homeStoreId) throw new Error("Employee has no home store");

  const db = getDb();
  const [store] = await db
    .select({ code: stores.code, timezone: stores.timezone })
    .from(stores)
    .where(and(
      eq(stores.id, employee.homeStoreId),
      eq(stores.organizationId, employee.organizationId),
    ))
    .limit(1);

  if (!store) throw new Error("Store not found");

  const [
    { run: openingRun, tasks: openingTasks },
    { run: handoffRun, tasks: handoffTasks },
    openShortages,
    messages,
    inventory,
  ] = await Promise.all([
    getOrCreateChecklistRun(store.code, "MORNING", employee.id),
    getOrCreateChecklistRun(store.code, "HANDOFF", employee.id),
    countOpenShortages(employee.organizationId, employee.homeStoreId),
    getUnreadEmployeeMessages(employee.organizationId, employee.id),
    getOpsInventoryIntelligence(employee.organizationId,employee.homeStoreId),
  ]);

  const openingCompleted = openingTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;
  const handoffCompleted = handoffTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;
  const openingNext =
    openingTasks.find(
      (task) => task.status === "PENDING" && task.startedAt,
    ) ??
    openingTasks.find((task) => task.status === "PENDING") ??
    null;
  const handoffNext =
    handoffTasks.find(
      (task) => task.status === "PENDING" && task.startedAt,
    ) ??
    handoffTasks.find((task) => task.status === "PENDING") ??
    null;

  const [espressoRows, activeRoastRows, openEventRows] = await Promise.all([
    db
      .select({
        id: espressoQualityChecks.id,
        brewTimeS: espressoQualityChecks.brewTimeS,
        withinTimeSpec: espressoQualityChecks.withinTimeSpec,
        withinYieldSpec: espressoQualityChecks.withinYieldSpec,
        sensoryRating: espressoQualityChecks.sensoryRating,
        createdAt: espressoQualityChecks.createdAt,
      })
      .from(espressoQualityChecks)
      .where(and(
        eq(espressoQualityChecks.organizationId, employee.organizationId),
        eq(espressoQualityChecks.storeId, employee.homeStoreId),
        sql`to_char(${espressoQualityChecks.createdAt} at time zone ${store.timezone}, 'YYYY-MM-DD') = ${openingRun.businessDate}`,
      ))
      .orderBy(desc(espressoQualityChecks.createdAt))
      .limit(8),
    db
      .select({
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
      .where(and(
        eq(roastBarAssignments.organizationId, employee.organizationId),
        eq(roastBarAssignments.storeId, employee.homeStoreId),
        eq(roastBarAssignments.barRole, "ESPRESSO"),
        eq(roastBarAssignments.isActive, true),
      ))
      .orderBy(desc(roastBarAssignments.startedAt))
      .limit(1),
    db
      .select({
        id: operationalEvents.id,
        eventType: operationalEvents.eventType,
        severity: operationalEvents.severity,
        itemNameSnapshot: operationalEvents.itemNameSnapshot,
        note: operationalEvents.note,
        occurredAt: operationalEvents.occurredAt,
      })
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.organizationId, employee.organizationId),
          eq(operationalEvents.storeId, employee.homeStoreId),
          isNull(operationalEvents.resolvedAt),
          inArray(operationalEvents.eventType, [
            "EQUIPMENT",
            "STOCK",
            "SERVICE",
            "OTHER",
          ]),
        ),
      )
      .orderBy(desc(operationalEvents.occurredAt))
      .limit(5),
  ]);

  const latestEspresso = espressoRows[0] ?? null;
  let consecutiveOutOfSpec = 0;
  for (const row of espressoRows) {
    const passed =
      row.withinTimeSpec && row.withinYieldSpec === true;
    if (passed) break;
    consecutiveOutOfSpec += 1;
  }

  const activeRoast = activeRoastRows[0] ?? null;

  return {
    businessDate: openingRun.businessDate,
    opening: {
      completed: openingCompleted,
      total: openingTasks.length,
      status: openingRun.status,
      next: openingNext
        ? {
            title: openingNext.titleSnapshot,
            started: Boolean(openingNext.startedAt),
          }
        : null,
    },
    handoff: {
      completed: handoffCompleted,
      total: handoffTasks.length,
      status: handoffRun.status,
      next: handoffNext
        ? {
            title: handoffNext.titleSnapshot,
            started: Boolean(handoffNext.startedAt),
          }
        : null,
    },
    inventory: {
      openShortages,
    },
    espresso: latestEspresso,
    espressoToday: {
      checks: espressoRows.length,
      consecutiveOutOfSpec,
      passRate:
        espressoRows.length > 0
          ? (espressoRows.filter(
              (row) =>
                row.withinTimeSpec &&
                row.withinYieldSpec === true,
            ).length /
              espressoRows.length) *
            100
          : null,
      averageTimeS:
        espressoRows.length > 0
          ? espressoRows.reduce(
              (sum, row) => sum + Number(row.brewTimeS),
              0,
            ) / espressoRows.length
          : null,
    },
    bar: {
      shift: inventory.shift.current,
      forecastSampleDays: inventory.shift.sampleDays,
      traffic: inventory.shift.traffic,
      topProducts: inventory.shift.topProducts,
      stockRisks: inventory.shift.risks,
      unavailableProducts: inventory.unavailableProducts,
      openEvents: openEventRows,
      activeRoast: activeRoast
        ? {
            ...activeRoast,
            ageDays: Math.max(
              0,
              (Date.now() - activeRoast.roastedAt.getTime()) /
                86_400_000,
            ),
          }
        : null,
    },
    messages,
  };
}
