import { and, desc, eq, sql } from "drizzle-orm";
import { getOrCreateChecklistRun } from "@/src/application/checklists/run";
import { countOpenShortages } from "@/src/application/inventory/shortages";
import { getUnreadEmployeeMessages } from "@/src/application/messages/read";
import { getDb } from "@/src/infrastructure/db/client";
import { espressoQualityChecks, stores } from "@/src/infrastructure/db/schema";

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
  ] = await Promise.all([
    getOrCreateChecklistRun(store.code, "MORNING", employee.id),
    getOrCreateChecklistRun(store.code, "HANDOFF", employee.id),
    countOpenShortages(employee.organizationId, employee.homeStoreId),
    getUnreadEmployeeMessages(employee.organizationId, employee.id),
  ]);

  const openingCompleted = openingTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;
  const handoffCompleted = handoffTasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;

  const [latestEspresso] = await db
    .select({
      id: espressoQualityChecks.id,
      brewTimeS: espressoQualityChecks.brewTimeS,
      withinTimeSpec: espressoQualityChecks.withinTimeSpec,
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
    .limit(1);

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
    espresso: latestEspresso ?? null,
    messages,
  };
}
