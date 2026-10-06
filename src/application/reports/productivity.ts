import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
} from "drizzle-orm";
import { elapsedSeconds } from "@/src/domain/checklists/timing";
import { getDb } from "@/src/infrastructure/db/client";
import {
  checklistRuns,
  checklistRunTasks,
  employees,
} from "@/src/infrastructure/db/schema";

export async function getProductivityReport(
  organizationId: string,
  days = 30,
) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({
      id: checklistRunTasks.id,
      title: checklistRunTasks.titleSnapshot,
      targetSeconds: checklistRunTasks.targetDurationSecondsSnapshot,
      startedAt: checklistRunTasks.startedAt,
      completedAt: checklistRunTasks.completedAt,
      completedByEmployeeId: checklistRunTasks.completedByEmployeeId,
      employeeName: employees.name,
      businessDate: checklistRuns.businessDate,
      shiftType: checklistRuns.shiftType,
    })
    .from(checklistRunTasks)
    .innerJoin(
      checklistRuns,
      eq(checklistRuns.id, checklistRunTasks.checklistRunId),
    )
    .leftJoin(
      employees,
      eq(employees.id, checklistRunTasks.completedByEmployeeId),
    )
    .where(
      and(
        eq(checklistRunTasks.organizationId, organizationId),
        eq(checklistRunTasks.status, "COMPLETED"),
        isNotNull(checklistRunTasks.targetDurationSecondsSnapshot),
        isNotNull(checklistRunTasks.startedAt),
        isNotNull(checklistRunTasks.completedAt),
        gte(checklistRunTasks.completedAt, since),
      ),
    )
    .orderBy(desc(checklistRunTasks.completedAt));

  const measured = rows.flatMap((row) => {
    if (
      !row.startedAt ||
      !row.completedAt ||
      !row.targetSeconds ||
      row.targetSeconds <= 0
    ) {
      return [];
    }

    const actualSeconds = elapsedSeconds(row.startedAt, row.completedAt);
    if (actualSeconds == null) return [];

    const varianceSeconds = actualSeconds - row.targetSeconds;
    const variancePercent = (varianceSeconds / row.targetSeconds) * 100;

    return [{
      ...row,
      actualSeconds,
      varianceSeconds,
      variancePercent,
      onTarget: actualSeconds <= row.targetSeconds,
    }];
  });

  const grouped = new Map<
    string,
    {
      employeeId: string | null;
      employeeName: string;
      measuredTasks: number;
      onTargetTasks: number;
      totalActualSeconds: number;
      totalTargetSeconds: number;
      totalVariancePercent: number;
    }
  >();

  for (const row of measured) {
    const key = row.completedByEmployeeId ?? "unassigned";
    const current = grouped.get(key) ?? {
      employeeId: row.completedByEmployeeId,
      employeeName: row.employeeName ?? "Sin empleado",
      measuredTasks: 0,
      onTargetTasks: 0,
      totalActualSeconds: 0,
      totalTargetSeconds: 0,
      totalVariancePercent: 0,
    };

    current.measuredTasks += 1;
    current.onTargetTasks += row.onTarget ? 1 : 0;
    current.totalActualSeconds += row.actualSeconds;
    current.totalTargetSeconds += row.targetSeconds;
    current.totalVariancePercent += row.variancePercent;
    grouped.set(key, current);
  }

  const employeeSummaries = Array.from(grouped.values())
    .map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      measuredTasks: row.measuredTasks,
      onTargetTasks: row.onTargetTasks,
      onTargetRate:
        row.measuredTasks > 0
          ? (row.onTargetTasks / row.measuredTasks) * 100
          : 0,
      avgActualSeconds:
        row.measuredTasks > 0
          ? Math.round(row.totalActualSeconds / row.measuredTasks)
          : 0,
      avgTargetSeconds:
        row.measuredTasks > 0
          ? Math.round(row.totalTargetSeconds / row.measuredTasks)
          : 0,
      avgVariancePercent:
        row.measuredTasks > 0
          ? row.totalVariancePercent / row.measuredTasks
          : 0,
    }))
    .sort((a, b) => b.measuredTasks - a.measuredTasks);

  const recentExceptions = measured
    .filter((row) => row.varianceSeconds > 0)
    .sort((a, b) => b.variancePercent - a.variancePercent)
    .slice(0, 20);

  return {
    days,
    since,
    measuredTasks: measured.length,
    employeeSummaries,
    recentExceptions,
  };
}
