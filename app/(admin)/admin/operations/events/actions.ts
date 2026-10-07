"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  operationalEvents,
} from "@/src/infrastructure/db/schema";

export async function resolveOperationalEvent(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) return;

  const { user, employeeId, organizationId } =
    await requirePermission("admin.access");
  const db = getDb();
  const now = new Date();

  const [updated] = await db
    .update(operationalEvents)
    .set({
      resolvedAt: now,
      resolvedByEmployeeId: employeeId,
    })
    .where(
      and(
        eq(operationalEvents.id, eventId),
        eq(operationalEvents.organizationId, organizationId),
        isNull(operationalEvents.resolvedAt),
      ),
    )
    .returning({ id: operationalEvents.id });

  if (!updated) return;

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "OPERATIONAL_EVENT_RESOLVED",
    entityType: "operational_event",
    entityId: updated.id,
    afterData: { resolvedAt: now.toISOString() },
  });

  revalidatePath("/admin/operations/events");
  revalidatePath("/admin/decision-center");
}
