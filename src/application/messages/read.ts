import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { employeeMessages, employees } from "@/src/infrastructure/db/schema";

export async function getUnreadEmployeeMessages(
  organizationId: string,
  employeeId: string,
  limit = 10,
) {
  return getDb()
    .select({
      id: employeeMessages.id,
      title: employeeMessages.title,
      body: employeeMessages.body,
      priority: employeeMessages.priority,
      createdAt: employeeMessages.createdAt,
    })
    .from(employeeMessages)
    .where(
      and(
        eq(employeeMessages.organizationId, organizationId),
        eq(employeeMessages.recipientEmployeeId, employeeId),
        isNull(employeeMessages.readAt),
        isNull(employeeMessages.dismissedAt),
      ),
    )
    .orderBy(desc(employeeMessages.createdAt))
    .limit(limit);
}

export async function getMessageAdminData(
  organizationId: string,
  limit = 30,
) {
  const db = getDb();

  const [employeeOptions, recentMessages] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        homeStoreId: employees.homeStoreId,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organizationId, organizationId),
          eq(employees.isActive, true),
        ),
      )
      .orderBy(employees.name),
    db
      .select({
        id: employeeMessages.id,
        recipientEmployeeId: employeeMessages.recipientEmployeeId,
        recipientName: employees.name,
        title: employeeMessages.title,
        body: employeeMessages.body,
        priority: employeeMessages.priority,
        readAt: employeeMessages.readAt,
        createdAt: employeeMessages.createdAt,
      })
      .from(employeeMessages)
      .innerJoin(
        employees,
        eq(employees.id, employeeMessages.recipientEmployeeId),
      )
      .where(eq(employeeMessages.organizationId, organizationId))
      .orderBy(desc(employeeMessages.createdAt))
      .limit(limit),
  ]);

  return { employeeOptions, recentMessages };
}
