"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, employeeMessages } from "@/src/infrastructure/db/schema";

export async function markEmployeeMessageRead(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  if (!messageId) return;

  const { user, employee } = await getCurrentEmployee();
  const db = getDb();

  const [message] = await db
    .select({
      id: employeeMessages.id,
      storeId: employeeMessages.storeId,
    })
    .from(employeeMessages)
    .where(
      and(
        eq(employeeMessages.id, messageId),
        eq(employeeMessages.organizationId, employee.organizationId),
        eq(employeeMessages.recipientEmployeeId, employee.id),
        isNull(employeeMessages.readAt),
      ),
    )
    .limit(1);

  if (!message) {
    revalidatePath("/today");
    return;
  }

  const readAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(employeeMessages)
      .set({ readAt, updatedAt: readAt })
      .where(eq(employeeMessages.id, message.id));

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: message.storeId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "EMPLOYEE_MESSAGE_READ",
      entityType: "employee_message",
      entityId: message.id,
      afterData: { readAt: readAt.toISOString() },
    });
  });

  revalidatePath("/today");
  revalidatePath("/admin/messages");
}
