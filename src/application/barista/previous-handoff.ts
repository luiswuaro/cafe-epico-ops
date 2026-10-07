import { and, desc, eq } from "drizzle-orm";
import { elapsedSeconds } from "@/src/domain/checklists/timing";
import { getDb } from "@/src/infrastructure/db/client";
import {
  checklistRuns,
  checklistRunTasks,
  employees,
} from "@/src/infrastructure/db/schema";

export async function getLatestCompletedHandoffSummary(
  organizationId: string,
  storeId: string | null,
) {
  const db = getDb();
  const conditions = [
    eq(checklistRuns.organizationId, organizationId),
    eq(checklistRuns.shiftType, "HANDOFF"),
    eq(checklistRuns.status, "COMPLETED"),
  ];

  if (storeId) conditions.push(eq(checklistRuns.storeId, storeId));

  const [run] = await db
    .select({
      id: checklistRuns.id,
      businessDate: checklistRuns.businessDate,
      startedAt: checklistRuns.startedAt,
      completedAt: checklistRuns.completedAt,
      startedByEmployeeId: checklistRuns.startedByEmployeeId,
      completedByEmployeeId: checklistRuns.completedByEmployeeId,
      closingNote: checklistRuns.closingNote,
    })
    .from(checklistRuns)
    .where(and(...conditions))
    .orderBy(
      desc(checklistRuns.completedAt),
      desc(checklistRuns.businessDate),
    )
    .limit(1);

  if (!run) return null;

  const tasks = await db
    .select({
      status: checklistRunTasks.status,
      targetSeconds: checklistRunTasks.targetDurationSecondsSnapshot,
      startedAt: checklistRunTasks.startedAt,
      completedAt: checklistRunTasks.completedAt,
      comment: checklistRunTasks.comment,
    })
    .from(checklistRunTasks)
    .where(eq(checklistRunTasks.checklistRunId, run.id));

  const responsibleId =
    run.completedByEmployeeId ?? run.startedByEmployeeId ?? null;
  const [responsible] = responsibleId
    ? await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(eq(employees.id, responsibleId))
        .limit(1)
    : [];

  const completedTasks = tasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;

  const measured = tasks.flatMap((task) => {
    if (
      task.targetSeconds == null ||
      task.targetSeconds <= 0 ||
      !task.startedAt ||
      !task.completedAt
    ) {
      return [];
    }

    const actualSeconds = elapsedSeconds(task.startedAt, task.completedAt);
    if (actualSeconds == null) return [];

    return [{
      targetSeconds: task.targetSeconds,
      actualSeconds,
      onTarget: actualSeconds <= task.targetSeconds,
    }];
  });

  const onTargetTasks = measured.filter((task) => task.onTarget).length;

  return {
    id: run.id,
    businessDate: run.businessDate,
    completedAt: run.completedAt,
    employeeId: responsible?.id ?? responsibleId,
    employeeName: responsible?.name ?? "Responsable sin identificar",
    closingNote: run.closingNote,
    taskCount: tasks.length,
    completedTasks,
    measuredTasks: measured.length,
    onTargetTasks,
    onTargetRate:
      measured.length > 0 ? (onTargetTasks / measured.length) * 100 : null,
    taskNotes: tasks.filter((task) => Boolean(task.comment?.trim())).length,
  };
}
