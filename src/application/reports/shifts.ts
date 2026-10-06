import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  checklistRuns,
  checklistRunTasks,
  checklistTemplates,
  employees,
} from "@/src/infrastructure/db/schema";

export type ShiftReportFilter = "ALL" | "MORNING" | "HANDOFF";

function durationSeconds(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) return null;
  return Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

export async function getShiftReports(
  organizationId: string,
  filter: ShiftReportFilter = "ALL",
  limit = 20,
) {
  const db = getDb();

  const condition =
    filter === "ALL"
      ? eq(checklistRuns.organizationId, organizationId)
      : and(
          eq(checklistRuns.organizationId, organizationId),
          eq(checklistRuns.shiftType, filter),
        );

  const runs = await db
    .select({
      id: checklistRuns.id,
      businessDate: checklistRuns.businessDate,
      shiftType: checklistRuns.shiftType,
      status: checklistRuns.status,
      startedAt: checklistRuns.startedAt,
      completedAt: checklistRuns.completedAt,
      startedByEmployeeId: checklistRuns.startedByEmployeeId,
      templateName: checklistTemplates.name,
    })
    .from(checklistRuns)
    .innerJoin(
      checklistTemplates,
      eq(checklistTemplates.id, checklistRuns.checklistTemplateId),
    )
    .where(condition)
    .orderBy(desc(checklistRuns.businessDate), desc(checklistRuns.startedAt))
    .limit(limit);

  if (runs.length === 0) return [];

  const runIds = runs.map((run) => run.id);

  const tasks = await db
    .select({
      id: checklistRunTasks.id,
      checklistRunId: checklistRunTasks.checklistRunId,
      title: checklistRunTasks.titleSnapshot,
      status: checklistRunTasks.status,
      startedAt: checklistRunTasks.startedAt,
      completedAt: checklistRunTasks.completedAt,
      startedByEmployeeId: checklistRunTasks.startedByEmployeeId,
      completedByEmployeeId: checklistRunTasks.completedByEmployeeId,
      numericValue: checklistRunTasks.numericValue,
      textValue: checklistRunTasks.textValue,
      booleanValue: checklistRunTasks.booleanValue,
      comment: checklistRunTasks.comment,
      validationStatus: checklistRunTasks.validationStatus,
      targetDurationSeconds: checklistRunTasks.targetDurationSecondsSnapshot,
    })
    .from(checklistRunTasks)
    .where(inArray(checklistRunTasks.checklistRunId, runIds))
    .orderBy(checklistRunTasks.createdAt);

  const employeeIds = Array.from(
    new Set(
      [
        ...runs.map((run) => run.startedByEmployeeId),
        ...tasks.map((task) => task.startedByEmployeeId),
        ...tasks.map((task) => task.completedByEmployeeId),
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  const employeeRows =
    employeeIds.length > 0
      ? await db
          .select({ id: employees.id, name: employees.name })
          .from(employees)
          .where(inArray(employees.id, employeeIds))
      : [];

  const employeeName = new Map(
    employeeRows.map((employee) => [employee.id, employee.name]),
  );

  return runs.map((run) => ({
    ...run,
    startedByName: run.startedByEmployeeId
      ? employeeName.get(run.startedByEmployeeId) ?? null
      : null,
    durationSeconds: durationSeconds(run.startedAt, run.completedAt),
    tasks: tasks
      .filter((task) => task.checklistRunId === run.id)
      .map((task) => ({
        ...task,
        startedByName: task.startedByEmployeeId
          ? employeeName.get(task.startedByEmployeeId) ?? null
          : null,
        completedByName: task.completedByEmployeeId
          ? employeeName.get(task.completedByEmployeeId) ?? null
          : null,
        durationSeconds: durationSeconds(
          task.startedAt,
          task.completedAt,
        ),
      })),
  }));
}
