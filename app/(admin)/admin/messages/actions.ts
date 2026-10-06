"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  employeeMessages,
  employees,
} from "@/src/infrastructure/db/schema";

const messageSchema = z.object({
  recipientEmployeeId: z.string().uuid(),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(2000),
  priority: z.enum(["NORMAL", "IMPORTANT"]),
});

export async function sendEmployeeMessage(formData: FormData) {
  const parsed = messageSchema.safeParse({
    recipientEmployeeId: String(
      formData.get("recipientEmployeeId") ?? "",
    ),
    title: String(formData.get("title") ?? "").trim() || undefined,
    body: String(formData.get("body") ?? ""),
    priority: String(formData.get("priority") ?? "NORMAL"),
  });

  if (!parsed.success) {
    redirect("/admin/messages?error=invalid");
  }

  const { employeeId, user, organizationId } =
    await requirePermission("admin.access");
  const db = getDb();

  const [recipient] = await db
    .select({
      id: employees.id,
      homeStoreId: employees.homeStoreId,
    })
    .from(employees)
    .where(
      and(
        eq(employees.id, parsed.data.recipientEmployeeId),
        eq(employees.organizationId, organizationId),
        eq(employees.isActive, true),
      ),
    )
    .limit(1);

  if (!recipient) {
    redirect("/admin/messages?error=recipient");
  }

  const [message] = await db
    .insert(employeeMessages)
    .values({
      organizationId,
      storeId: recipient.homeStoreId,
      recipientEmployeeId: recipient.id,
      senderEmployeeId: employeeId,
      title: parsed.data.title ?? "Nota de operación",
      body: parsed.data.body,
      priority: parsed.data.priority,
    })
    .returning({ id: employeeMessages.id });

  await db.insert(auditEvents).values({
    organizationId,
    storeId: recipient.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "EMPLOYEE_MESSAGE_SENT",
    entityType: "employee_message",
    entityId: message.id,
    afterData: {
      recipientEmployeeId: recipient.id,
      title: parsed.data.title ?? "Nota de operación",
      priority: parsed.data.priority,
    },
  });

  revalidatePath("/today");
  revalidatePath("/admin/messages");
  redirect("/admin/messages?sent=1");
}
