import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { checklistTasks, checklistTaskSchedules, checklistTemplates, sops, stores } from "@/src/infrastructure/db/schema";

export async function getChecklistAdminData(organizationId: string, storeCode: string) {
  const db = getDb();
  const templates = await db.select({ id: checklistTemplates.id, name: checklistTemplates.name, shiftType: checklistTemplates.shiftType })
    .from(checklistTemplates).innerJoin(stores, eq(stores.id, checklistTemplates.storeId)).where(and(eq(stores.organizationId, organizationId), eq(stores.code, storeCode)));
  const tasks = templates.length ? await db.select({
    id: checklistTasks.id, templateId: checklistTasks.checklistTemplateId, title: checklistTasks.title, area: checklistTasks.area,
    priority: checklistTasks.priority, inputType: checklistTasks.inputType, required: checklistTasks.isRequired, active: checklistTasks.isActive,
    sortOrder: checklistTasks.sortOrder, targetDurationSeconds: checklistTasks.targetDurationSeconds, rrule: checklistTaskSchedules.rrule, sopId: checklistTasks.sopId,
  }).from(checklistTasks).leftJoin(checklistTaskSchedules, eq(checklistTaskSchedules.checklistTaskId, checklistTasks.id))
    .where(and(eq(checklistTasks.organizationId, organizationId), inArray(checklistTasks.checklistTemplateId, templates.map(t => t.id))))
    .orderBy(asc(checklistTasks.sortOrder)) : [];
  const sopOptions = await db.select({ id: sops.id, title: sops.title }).from(sops).where(and(eq(sops.organizationId, organizationId), eq(sops.isActive, true)));
  return { templates, tasks, sopOptions };
}
