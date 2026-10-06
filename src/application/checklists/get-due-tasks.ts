import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { checklistTaskSchedules, checklistTasks, checklistTemplates, sops, stores } from "@/src/infrastructure/db/schema";
import { isRecurrenceDue } from "@/src/domain/checklists/recurrence";

export async function getDueChecklistTasks(organizationId: string, storeCode: string, shiftType: string, at = new Date()) {
  const db = getDb();
  const rows = await db.select({
    taskId: checklistTasks.id, title: checklistTasks.title, description: checklistTasks.description,
    area: checklistTasks.area, priority: checklistTasks.priority, required: checklistTasks.isRequired,
    sortOrder: checklistTasks.sortOrder, inputType: checklistTasks.inputType, config: checklistTasks.config, sopVersionId: sops.currentVersionId,
    rrule: checklistTaskSchedules.rrule, startDate: checklistTaskSchedules.startDate, timezone: checklistTaskSchedules.timezone,
  }).from(checklistTasks)
    .innerJoin(checklistTemplates, eq(checklistTemplates.id, checklistTasks.checklistTemplateId))
    .innerJoin(stores, eq(stores.id, checklistTemplates.storeId))
    .leftJoin(sops, eq(sops.id, checklistTasks.sopId))
    .leftJoin(checklistTaskSchedules, and(eq(checklistTaskSchedules.checklistTaskId, checklistTasks.id), eq(checklistTaskSchedules.isActive, true)))
    .where(and(eq(stores.organizationId, organizationId), eq(stores.code, storeCode), eq(checklistTemplates.shiftType, shiftType), eq(checklistTemplates.isActive, true), eq(checklistTasks.isActive, true)));

  return rows.filter((row) => !row.rrule || !row.startDate || isRecurrenceDue({ rrule: row.rrule, startDate: row.startDate, timezone: row.timezone ?? "America/Mexico_City" }, at))
    .sort((a,b) => a.sortOrder - b.sortOrder);
}
