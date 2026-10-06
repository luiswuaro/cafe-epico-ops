"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { getDb } from "@/src/infrastructure/db/client";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { checklistRuns, checklistRunTasks } from "@/src/infrastructure/db/schema";

export async function completeChecklistTask(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) throw new Error("Missing taskId");
  const { employee } = await getCurrentEmployee();
  const db = getDb();
  const [task] = await db.select({ task: checklistRunTasks, run: checklistRuns })
    .from(checklistRunTasks).innerJoin(checklistRuns, eq(checklistRuns.id, checklistRunTasks.checklistRunId))
    .where(and(eq(checklistRunTasks.id, taskId), eq(checklistRuns.organizationId, employee.organizationId))).limit(1);
  if (!task) throw new Error("Checklist task not found or outside employee organization");
  await assertEmployeePermission(employee.id, "checklist.execute", task.run.storeId);

  const rawValue = String(formData.get("value") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const update: Partial<typeof checklistRunTasks.$inferInsert> = {
    status: "COMPLETED", completedByEmployeeId: employee.id, completedAt: new Date(), comment, validationStatus: "OK",
  };
  if (task.task.inputTypeSnapshot === "NUMBER" || task.task.inputTypeSnapshot === "TEMPERATURE" || task.task.inputTypeSnapshot === "WEIGHT" || task.task.inputTypeSnapshot === "TIME") {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error("A numeric value is required");
    update.numericValue = String(value);
  } else if (task.task.inputTypeSnapshot === "TEXT" || task.task.inputTypeSnapshot === "SELECT") {
    if (!rawValue && task.task.requiredSnapshot) throw new Error("A value is required");
    update.textValue = rawValue;
  } else update.booleanValue = true;

  await db.update(checklistRunTasks).set(update).where(eq(checklistRunTasks.id, taskId));
  revalidatePath("/checklists");
}
