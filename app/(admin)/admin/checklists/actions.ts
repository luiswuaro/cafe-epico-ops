"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  checklistTasks,
  checklistTaskSchedules,
  checklistTemplates,
} from "@/src/infrastructure/db/schema";

const DAY_CODES = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

function optionalNumber(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} debe ser numérico`);
  }
  return String(value);
}

function optionalTargetSeconds(formData: FormData) {
  const raw = String(formData.get("targetMinutes") ?? "").trim();
  if (!raw) return null;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480) {
    throw new Error("El tiempo objetivo debe ser mayor a 0 y máximo 480 min");
  }

  return Math.max(1, Math.round(minutes * 60));
}

function buildRrule(formData: FormData) {
  const frequency = String(formData.get("frequency") ?? "ALWAYS");

  if (frequency === "ALWAYS") return "";
  if (frequency === "DAILY") return "FREQ=DAILY";
  if (frequency === "WEEKDAYS") {
    return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  }

  if (frequency === "WEEKLY") {
    const weekday = String(formData.get("weekday") ?? "MO");
    if (!DAY_CODES.has(weekday)) throw new Error("Día semanal inválido");
    return `FREQ=WEEKLY;BYDAY=${weekday}`;
  }

  if (frequency === "INTERVAL_DAYS") {
    const interval = Number(formData.get("intervalDays") ?? 1);
    if (!Number.isInteger(interval) || interval < 2 || interval > 365) {
      throw new Error("El intervalo debe ser entre 2 y 365 días");
    }
    return `FREQ=DAILY;INTERVAL=${interval}`;
  }

  throw new Error("Frecuencia inválida");
}

export async function createChecklistTask(formData: FormData) {
  const { employeeId, user, organizationId } =
    await requirePermission("checklist.manage");

  const templateId = String(formData.get("templateId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description =
    String(formData.get("description") ?? "").trim() || null;
  const area = String(formData.get("area") ?? "Operación").trim();
  const priority = String(formData.get("priority") ?? "NORMAL");
  const inputType = String(
    formData.get("inputType") ?? "BOOLEAN",
  ) as (typeof checklistTasks.$inferInsert)["inputType"];
  const rrule = buildRrule(formData);
  const sopId = String(formData.get("sopId") ?? "").trim() || null;
  const minValue = optionalNumber(formData, "minValue");
  const maxValue = optionalNumber(formData, "maxValue");
  const targetDurationSeconds = optionalTargetSeconds(formData);

  if (!templateId || !title) {
    throw new Error("Checklist y tarea son obligatorios");
  }

  if (
    minValue != null &&
    maxValue != null &&
    Number(minValue) > Number(maxValue)
  ) {
    throw new Error("El mínimo no puede ser mayor que el máximo");
  }

  const db = getDb();

  const [template] = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, templateId))
    .limit(1);

  if (!template || template.organizationId !== organizationId) {
    throw new Error("Checklist template not found");
  }

  const [task] = await db
    .insert(checklistTasks)
    .values({
      organizationId: template.organizationId,
      checklistTemplateId: template.id,
      title,
      description,
      area,
      priority,
      inputType,
      isRequired: formData.get("required") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 1000),
      sopId,
      minValue,
      maxValue,
      targetDurationSeconds,
    })
    .returning();

  if (rrule) {
    await db.insert(checklistTaskSchedules).values({
      organizationId: template.organizationId,
      checklistTaskId: task.id,
      rrule,
      startDate: new Date(),
      timezone: "America/Mexico_City",
    });
  }

  await db.insert(auditEvents).values({
    organizationId: template.organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "CHECKLIST_TASK_CREATED",
    entityType: "checklist_task",
    entityId: task.id,
    afterData: {
      title,
      description,
      area,
      priority,
      inputType,
      rrule: rrule || null,
      sopId,
      minValue,
      maxValue,
      targetDurationSeconds,
    },
  });

  revalidatePath("/admin/checklists");
  revalidatePath("/checklists");
  revalidatePath("/handoff");
  revalidatePath("/today");
}

export async function updateChecklistTaskTarget(formData: FormData) {
  const { employeeId, user, organizationId } =
    await requirePermission("checklist.manage");

  const taskId = String(formData.get("taskId") ?? "");
  const targetDurationSeconds = optionalTargetSeconds(formData);
  const db = getDb();

  const [before] = await db
    .select({
      id: checklistTasks.id,
      organizationId: checklistTasks.organizationId,
      targetDurationSeconds: checklistTasks.targetDurationSeconds,
    })
    .from(checklistTasks)
    .where(eq(checklistTasks.id, taskId))
    .limit(1);

  if (!before || before.organizationId !== organizationId) {
    throw new Error("Task not found");
  }

  await db
    .update(checklistTasks)
    .set({
      targetDurationSeconds,
      updatedAt: new Date(),
    })
    .where(eq(checklistTasks.id, taskId));

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "CHECKLIST_TASK_TARGET_UPDATED",
    entityType: "checklist_task",
    entityId: taskId,
    beforeData: { targetDurationSeconds: before.targetDurationSeconds },
    afterData: { targetDurationSeconds },
  });

  revalidatePath("/admin/checklists");
  revalidatePath("/admin/reports/productivity");
  revalidatePath("/checklists");
  revalidatePath("/handoff");
}

export async function toggleChecklistTask(formData: FormData) {
  const { employeeId, user, organizationId } =
    await requirePermission("checklist.manage");

  const taskId = String(formData.get("taskId") ?? "");
  const active = String(formData.get("active")) === "true";
  const db = getDb();

  const [before] = await db
    .select()
    .from(checklistTasks)
    .where(eq(checklistTasks.id, taskId))
    .limit(1);

  if (!before || before.organizationId !== organizationId) {
    throw new Error("Task not found");
  }

  await db
    .update(checklistTasks)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(checklistTasks.id, taskId));

  await db.insert(auditEvents).values({
    organizationId: before.organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: active
      ? "CHECKLIST_TASK_ENABLED"
      : "CHECKLIST_TASK_DISABLED",
    entityType: "checklist_task",
    entityId: taskId,
    beforeData: { isActive: before.isActive },
    afterData: { isActive: active },
  });

  revalidatePath("/admin/checklists");
  revalidatePath("/checklists");
  revalidatePath("/handoff");
  revalidatePath("/today");
}
