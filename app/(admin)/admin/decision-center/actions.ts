"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  operationalEvents,
} from "@/src/infrastructure/db/schema";

export async function resolveOperationalIncident(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId) return;

  const { user, employeeId, organizationId } =
    await requirePermission("admin.access");
  const db = getDb();
  const now = new Date();

  const [event] = await db
    .select({ id: operationalEvents.id })
    .from(operationalEvents)
    .where(
      and(
        eq(operationalEvents.id, eventId),
        eq(operationalEvents.organizationId, organizationId),
        eq(operationalEvents.eventType, "BAR_INCIDENT"),
      ),
    )
    .limit(1);

  if (!event) return;

  await db.transaction(async (tx) => {
    await tx
      .update(operationalEvents)
      .set({
        resolvedAt: now,
        resolvedByEmployeeId: employeeId,
      })
      .where(eq(operationalEvents.id, eventId));

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "BAR_INCIDENT_RESOLVED",
      entityType: "operational_event",
      entityId: eventId,
      afterData: { resolvedAt: now.toISOString() },
    });
  });

  revalidatePath("/admin/decision-center");
  revalidatePath("/today");
}
