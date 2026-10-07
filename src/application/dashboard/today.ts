import { and, desc, eq, sql } from "drizzle-orm";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { countOpenShortages } from "@/src/application/inventory/shortages";
import { getUnreadEmployeeMessages } from "@/src/application/messages/read";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getDb } from "@/src/infrastructure/db/client";
import {
  espressoQualityChecks,
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
    getInventoryIntelligence(employee.organizationId),
  ]);

  const openingCompleted = openingTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;
  const handoffCompleted = handoffTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;

  const [espressoRows, activeRoastRows] = await Promise.all([
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
    },
    handoff: {
      completed: handoffCompleted,
      total: handoffTasks.length,
      status: handoffRun.status,
    },
    inventory: {
      openShortages,
    },
    espresso: latestEspresso,
    espressoToday: {
      checks: espressoRows.length,
      consecutiveOutOfSpec,
    },
    bar: {
      shift: inventory.shift.current,
      forecastSampleDays: inventory.shift.sampleDays,
      traffic: inventory.shift.traffic,
      stockRisks: inventory.shift.risks,
      unavailableProducts: inventory.unavailableProducts,
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
