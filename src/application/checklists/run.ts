import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { checklistRuns, checklistRunTasks, checklistTemplates, employees, stores } from "@/src/infrastructure/db/schema";
import { getDueChecklistTasks } from "./get-due-tasks";

export function businessDate(at = new Date(), timezone = "America/Mexico_City") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function getOrCreateChecklistRun(storeCode: string, shiftType: string, employeeId: string, at = new Date()) {
  const db = getDb();
  const [employee] = await db.select({ organizationId: employees.organizationId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee) throw new Error("Employee not found");
  const [ctx] = await db.select({ storeId: stores.id, orgId: stores.organizationId, timezone: stores.timezone, templateId: checklistTemplates.id })
    .from(stores).innerJoin(checklistTemplates, and(eq(checklistTemplates.storeId, stores.id), eq(checklistTemplates.shiftType, shiftType), eq(checklistTemplates.isActive, true)))
    .where(and(eq(stores.organizationId, employee.organizationId), eq(stores.code, storeCode), eq(stores.isActive, true))).limit(1);
  if (!ctx) throw new Error(`No active ${shiftType} checklist template for ${storeCode}`);
  const date = businessDate(at, ctx.timezone);

  let [run] = await db.select().from(checklistRuns).where(and(eq(checklistRuns.storeId, ctx.storeId), eq(checklistRuns.checklistTemplateId, ctx.templateId), eq(checklistRuns.businessDate, date))).limit(1);
  if (!run) {
    [run] = await db.insert(checklistRuns).values({ organizationId: ctx.orgId, storeId: ctx.storeId, checklistTemplateId: ctx.templateId, businessDate: date, shiftType, startedByEmployeeId: employeeId })
      .onConflictDoNothing().returning();
    if (!run) [run] = await db.select().from(checklistRuns).where(and(eq(checklistRuns.storeId, ctx.storeId), eq(checklistRuns.checklistTemplateId, ctx.templateId), eq(checklistRuns.businessDate, date))).limit(1);
    if (!run) throw new Error("Unable to create checklist run");

    const existing = await db.select({ id: checklistRunTasks.id }).from(checklistRunTasks).where(eq(checklistRunTasks.checklistRunId, run.id)).limit(1);
    if (!existing.length) {
      const due = await getDueChecklistTasks(employee.organizationId, storeCode, shiftType, at);
      if (due.length) await db.insert(checklistRunTasks).values(due.map((task) => ({
        organizationId: ctx.orgId,
        checklistRunId: run.id,
        sourceTaskId: task.taskId,
        titleSnapshot: task.title,
        descriptionSnapshot: task.description,
        requiredSnapshot: task.required,
        inputTypeSnapshot: task.inputType,
        sopVersionId: task.sopVersionId,
      })));
    }
  }
  const tasks = await db.select().from(checklistRunTasks).where(eq(checklistRunTasks.checklistRunId, run.id)).orderBy(asc(checklistRunTasks.createdAt));
  return { run, tasks };
}
