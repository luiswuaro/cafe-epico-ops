"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, checklistTasks, checklistTaskSchedules, checklistTemplates } from "@/src/infrastructure/db/schema";

export async function createChecklistTask(formData: FormData) {
  const { employeeId, user, organizationId } = await requirePermission("checklist.manage");
  const templateId = String(formData.get("templateId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const area = String(formData.get("area") ?? "Operación").trim();
  const priority = String(formData.get("priority") ?? "NORMAL");
  const inputType = String(formData.get("inputType") ?? "BOOLEAN") as (typeof checklistTasks.$inferInsert)["inputType"];
  const rrule = String(formData.get("rrule") ?? "").trim();
  const sopId = String(formData.get("sopId") ?? "").trim() || null;
  if (!templateId || !title) throw new Error("Template and title are required");
  const db = getDb();
  const [template] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, templateId)).limit(1);
  if (!template || template.organizationId !== organizationId) throw new Error("Checklist template not found");
  const [task] = await db.insert(checklistTasks).values({
    organizationId: template.organizationId, checklistTemplateId: template.id, title, area, priority,
    inputType, isRequired: formData.get("required") === "on", sortOrder: Number(formData.get("sortOrder") ?? 1000), sopId,
  }).returning();
  if (rrule) await db.insert(checklistTaskSchedules).values({ organizationId: template.organizationId, checklistTaskId: task.id, rrule, startDate: new Date(), timezone: "America/Mexico_City" });
  await db.insert(auditEvents).values({ organizationId: template.organizationId, actorUserId: user.id, actorEmployeeId: employeeId, action: "CHECKLIST_TASK_CREATED", entityType: "checklist_task", entityId: task.id, afterData: { title, area, priority, inputType, rrule, sopId } });
  revalidatePath("/admin/checklists"); revalidatePath("/checklists");
}

export async function toggleChecklistTask(formData: FormData) {
  const { employeeId, user, organizationId } = await requirePermission("checklist.manage");
  const taskId = String(formData.get("taskId") ?? "");
  const active = String(formData.get("active")) === "true";
  const db = getDb();
  const [before] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, taskId)).limit(1);
  if (!before || before.organizationId !== organizationId) throw new Error("Task not found");
  await db.update(checklistTasks).set({ isActive: active, updatedAt: new Date() }).where(eq(checklistTasks.id, taskId));
  await db.insert(auditEvents).values({ organizationId: before.organizationId, actorUserId: user.id, actorEmployeeId: employeeId, action: active ? "CHECKLIST_TASK_ENABLED" : "CHECKLIST_TASK_DISABLED", entityType: "checklist_task", entityId: taskId, beforeData: { isActive: before.isActive }, afterData: { isActive: active } });
  revalidatePath("/admin/checklists"); revalidatePath("/checklists");
}
