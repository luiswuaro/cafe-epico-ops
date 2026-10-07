import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
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

export async function getShiftReportEmployees(organizationId: string) {
  return getDb()
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.isActive, true),
      ),
    )
    .orderBy(asc(employees.name));
}

export async function getShiftReports(
  organizationId: string,
  filter: ShiftReportFilter = "ALL",
  limit = 20,
  employeeId: string | null = null,
) {
  const db = getDb();

  const shiftCondition =
    filter === "ALL"
      ? eq(checklistRuns.organizationId, organizationId)
      : and(
          eq(checklistRuns.organizationId, organizationId),
          eq(checklistRuns.shiftType, filter),
        );

  const condition = employeeId
    ? and(
        shiftCondition,
        or(
          eq(checklistRuns.startedByEmployeeId, employeeId),
          eq(checklistRuns.completedByEmployeeId, employeeId),
        ),
      )
    : shiftCondition;

  const runs = await db
    .select({
      id: checklistRuns.id,
      businessDate: checklistRuns.businessDate,
      shiftType: checklistRuns.shiftType,
      status: checklistRuns.status,
      startedAt: checklistRuns.startedAt,
      completedAt: checklistRuns.completedAt,
      startedByEmployeeId: checklistRuns.startedByEmployeeId,
      completedByEmployeeId: checklistRuns.completedByEmployeeId,
      closingNote: checklistRuns.closingNote,
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
      required: checklistRunTasks.requiredSnapshot,
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
        ...runs.map((run) => run.completedByEmployeeId),
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

  return runs.map((run) => {
    const runTasks = tasks
      .filter((task) => task.checklistRunId === run.id)
      .map((task) => ({
        ...task,
        startedByName: task.startedByEmployeeId
          ? employeeName.get(task.startedByEmployeeId) ?? null
          : null,
        completedByName: task.completedByEmployeeId
          ? employeeName.get(task.completedByEmployeeId) ?? null
          : null,
        durationSeconds: durationSeconds(task.startedAt, task.completedAt),
      }));

    const completedTasks = runTasks.filter(
      (task) => task.status === "COMPLETED",
    ).length;
    const requiredTasks = runTasks.filter((task) => task.required);
    const requiredCompleted = requiredTasks.filter(
      (task) => task.status === "COMPLETED",
    ).length;
    const measured = runTasks.filter(
      (task) =>
        task.targetDurationSeconds != null &&
        task.targetDurationSeconds > 0 &&
        task.durationSeconds != null,
    );
    const onTargetTasks = measured.filter(
      (task) =>
        task.durationSeconds != null &&
        task.targetDurationSeconds != null &&
        task.durationSeconds <= task.targetDurationSeconds,
    ).length;

    return {
      ...run,
      startedByName: run.startedByEmployeeId
        ? employeeName.get(run.startedByEmployeeId) ?? null
        : null,
      completedByName: run.completedByEmployeeId
        ? employeeName.get(run.completedByEmployeeId) ?? null
        : null,
      durationSeconds: durationSeconds(run.startedAt, run.completedAt),
      taskCount: runTasks.length,
      completedTasks,
      requiredTaskCount: requiredTasks.length,
      requiredCompleted,
      completionRate:
        runTasks.length > 0 ? (completedTasks / runTasks.length) * 100 : 0,
      measuredTasks: measured.length,
      onTargetTasks,
      onTargetRate:
        measured.length > 0 ? (onTargetTasks / measured.length) * 100 : null,
      tasks: runTasks,
    };
  });
}
