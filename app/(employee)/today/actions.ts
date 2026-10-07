"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getInventoryIntelligence } from "@/src/application/loyverse/inventory-intelligence";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  operationalEvents,
} from "@/src/infrastructure/db/schema";

export async function reportBarWaste(formData: FormData) {
  const variantExternalId = String(
    formData.get("variantExternalId") ?? "",
  ).trim();
  const quantity = Number(formData.get("quantity"));
  const reason = String(formData.get("reason") ?? "OTRO").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (
    !variantExternalId ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 100000
  ) {
    redirect("/today?error=waste");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/today?error=store");

  await assertEmployeePermission(
    employee.id,
    "inventory.read",
    employee.homeStoreId,
  );

  const inventory = await getInventoryIntelligence(
    employee.organizationId,
  );
  const row = inventory.smartRows.find(
    (item) => item.variantExternalId === variantExternalId,
  );
  if (!row) redirect("/today?error=waste-item");

  const db = getDb();
  const [created] = await db
    .insert(operationalEvents)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      eventType: "WASTE",
      severity:
        quantity >= Math.max(1, row.avgDailyUsage14 * 0.2)
          ? "IMPORTANT"
          : "NORMAL",
      variantExternalId,
      itemNameSnapshot: row.itemName,
      quantity: String(quantity),
      unitLabel: row.unitLabel,
      displayQuantity: String(quantity),
      displayUnit: row.unitLabel,
      note: reason + (note ? " · " + note : ""),
      resolvedAt: new Date(),
      resolvedByEmployeeId: employee.id,
    })
    .returning({ id: operationalEvents.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "BAR_WASTE_REPORTED",
    entityType: "operational_event",
    entityId: created.id,
    afterData: {
      variantExternalId,
      itemName: row.itemName,
      quantity,
      unitLabel: row.unitLabel,
      reason,
      note,
    },
  });

  revalidatePath("/today");
  revalidatePath("/inventory");
  revalidatePath("/admin/decision-center");
  redirect("/today?saved=waste");
}

export async function reportBarIncident(formData: FormData) {
  const severity = String(formData.get("severity") ?? "NORMAL");
  const area = String(formData.get("area") ?? "BARRA").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (
    !note ||
    !["NORMAL", "IMPORTANT", "URGENT"].includes(severity)
  ) {
    redirect("/today?error=incident");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/today?error=store");

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    employee.homeStoreId,
  );

  const db = getDb();
  const [created] = await db
    .insert(operationalEvents)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      eventType: "BAR_INCIDENT",
      severity,
      itemNameSnapshot: area,
      note,
    })
    .returning({ id: operationalEvents.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "BAR_INCIDENT_REPORTED",
    entityType: "operational_event",
    entityId: created.id,
    afterData: { severity, area, note },
  });

  revalidatePath("/today");
  revalidatePath("/admin/decision-center");
  redirect("/today?saved=incident");
}
