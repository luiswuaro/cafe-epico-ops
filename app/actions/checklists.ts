"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { getDb } from "@/src/infrastructure/db/client";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { validateNumeric } from "@/src/application/checklists/validation";
import {
  auditEvents,
  checklistRuns,
  checklistRunTasks,
  checklistTasks,
} from "@/src/infrastructure/db/schema";

export async function startChecklistTask(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) throw new Error("Missing taskId");

  const { user, employee } = await getCurrentEmployee();
  const db = getDb();

  const [task] = await db
    .select({
      task: checklistRunTasks,
      run: checklistRuns,
    })
    .from(checklistRunTasks)
    .innerJoin(
      checklistRuns,
      eq(checklistRuns.id, checklistRunTasks.checklistRunId),
    )
    .where(
      and(
        eq(checklistRunTasks.id, taskId),
        eq(checklistRuns.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!task) throw new Error("Checklist task not found");

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    task.run.storeId,
  );

  if (task.task.status === "COMPLETED" || task.task.startedAt) {
    revalidatePath("/checklists");
    revalidatePath("/handoff");
    return;
  }

  const startedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(checklistRunTasks)
      .set({
        startedAt,
        startedByEmployeeId: employee.id,
      })
      .where(
        and(
          eq(checklistRunTasks.id, taskId),
          eq(checklistRunTasks.status, "PENDING"),
        ),
      );

    await tx.insert(auditEvents).values({
      organizationId: task.run.organizationId,
      storeId: task.run.storeId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "CHECKLIST_TASK_STARTED",
      entityType: "checklist_run_task",
      entityId: taskId,
      afterData: {
        checklistRunId: task.run.id,
        title: task.task.titleSnapshot,
        startedAt: startedAt.toISOString(),
      },
    });
  });

  revalidatePath("/checklists");
  revalidatePath("/handoff");
  revalidatePath("/today");
  revalidatePath("/admin/reports/shifts");
}

export async function completeChecklistTask(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) throw new Error("Missing taskId");

  const { user, employee } = await getCurrentEmployee();
  const db = getDb();

  const [task] = await db
    .select({
      task: checklistRunTasks,
      run: checklistRuns,
      minValue: checklistTasks.minValue,
      maxValue: checklistTasks.maxValue,
    })
    .from(checklistRunTasks)
    .innerJoin(checklistRuns, eq(checklistRuns.id, checklistRunTasks.checklistRunId))
    .leftJoin(checklistTasks, eq(checklistTasks.id, checklistRunTasks.sourceTaskId))
    .where(
      and(
        eq(checklistRunTasks.id, taskId),
        eq(checklistRuns.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!task) {
    throw new Error("Checklist task not found or outside employee organization");
  }

  await assertEmployeePermission(employee.id, "checklist.execute", task.run.storeId);

  if (task.task.status === "COMPLETED") {
    revalidatePath("/checklists");
    revalidatePath("/handoff");
    revalidatePath("/today");
    return;
  }

  if (!task.task.startedAt) {
    throw new Error("Inicia la tarea antes de completarla");
  }

  const rawValue = String(formData.get("value") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const update: Partial<typeof checklistRunTasks.$inferInsert> = {
    status: "COMPLETED",
    completedByEmployeeId: employee.id,
    completedAt: new Date(),
    comment,
    validationStatus: "OK",
  };

  if (
    task.task.inputTypeSnapshot === "NUMBER" ||
    task.task.inputTypeSnapshot === "TEMPERATURE" ||
    task.task.inputTypeSnapshot === "WEIGHT" ||
    task.task.inputTypeSnapshot === "TIME"
  ) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error("A numeric value is required");
    update.numericValue = String(value);
    const validation = validateNumeric(value, {
      min: task.minValue == null ? null : Number(task.minValue),
      max: task.maxValue == null ? null : Number(task.maxValue),
    });
    update.validationStatus = validation.ok ? "OK" : validation.reason;
  } else if (
    task.task.inputTypeSnapshot === "TEXT" ||
    task.task.inputTypeSnapshot === "SELECT"
  ) {
    if (!rawValue && task.task.requiredSnapshot) {
      throw new Error("A value is required");
    }
    update.textValue = rawValue;
  } else {
    update.booleanValue = true;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(checklistRunTasks)
      .set(update)
      .where(eq(checklistRunTasks.id, taskId));

    await tx.insert(auditEvents).values({
      organizationId: task.run.organizationId,
      storeId: task.run.storeId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "CHECKLIST_TASK_COMPLETED",
      entityType: "checklist_run_task",
      entityId: taskId,
      afterData: {
        checklistRunId: task.run.id,
        title: task.task.titleSnapshot,
        comment,
        numericValue: update.numericValue ?? null,
        textValue: update.textValue ?? null,
        booleanValue: update.booleanValue ?? null,
        startedAt: task.task.startedAt?.toISOString() ?? null,
        completedAt: update.completedAt instanceof Date
          ? update.completedAt.toISOString()
          : null,
        durationSeconds:
          update.completedAt instanceof Date && task.task.startedAt
            ? Math.max(
                0,
                Math.round(
                  (update.completedAt.getTime() -
                    task.task.startedAt.getTime()) /
                    1000,
                ),
              )
            : null,
      },
    });

    const runTasks = await tx
      .select({
        required: checklistRunTasks.requiredSnapshot,
        status: checklistRunTasks.status,
      })
      .from(checklistRunTasks)
      .where(eq(checklistRunTasks.checklistRunId, task.run.id));

    const requiredTasks = runTasks.filter((item) => item.required);
    const allRequiredCompleted =
      requiredTasks.length > 0 &&
      requiredTasks.every((item) => item.status === "COMPLETED");

    if (allRequiredCompleted && task.run.status !== "COMPLETED") {
      await tx
        .update(checklistRuns)
        .set({
          status: "COMPLETED",
          completedByEmployeeId: employee.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(checklistRuns.id, task.run.id));

      await tx.insert(auditEvents).values({
        organizationId: task.run.organizationId,
        storeId: task.run.storeId,
        actorUserId: user.id,
        actorEmployeeId: employee.id,
        action: "CHECKLIST_RUN_COMPLETED",
        entityType: "checklist_run",
        entityId: task.run.id,
        afterData: {
          businessDate: task.run.businessDate,
          shiftType: task.run.shiftType,
        },
      });
    }
  });

  revalidatePath("/checklists");
  revalidatePath("/handoff");
  revalidatePath("/today");
  revalidatePath("/admin/reports/shifts");
  revalidatePath("/admin/reports/productivity");
}

export async function saveChecklistRunNote(formData: FormData) {
  const runId = String(formData.get("runId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!runId) throw new Error("Missing runId");
  if (note.length > 2000) {
    throw new Error("La nota general no puede exceder 2000 caracteres");
  }

  const { user, employee } = await getCurrentEmployee();
  const db = getDb();

  const [run] = await db
    .select()
    .from(checklistRuns)
    .where(
      and(
        eq(checklistRuns.id, runId),
        eq(checklistRuns.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!run) throw new Error("Checklist run not found");

  await assertEmployeePermission(employee.id, "checklist.execute", run.storeId);

  const closingNote = note || null;

  await db.transaction(async (tx) => {
    await tx
      .update(checklistRuns)
      .set({ closingNote, updatedAt: new Date() })
      .where(eq(checklistRuns.id, run.id));

    await tx.insert(auditEvents).values({
      organizationId: run.organizationId,
      storeId: run.storeId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "CHECKLIST_RUN_NOTE_UPDATED",
      entityType: "checklist_run",
      entityId: run.id,
      beforeData: { closingNote: run.closingNote ?? null },
      afterData: { closingNote },
    });
  });

  revalidatePath("/handoff");
  revalidatePath("/checklists");
  revalidatePath("/today");
  revalidatePath("/admin/reports/shifts");
}
