"use server";

import { and, eq, isNull } from "drizzle-orm";
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
  const displayQuantity = Number(formData.get("quantity"));
  const reason = String(formData.get("reason") ?? "OTRO").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (
    !variantExternalId ||
    !Number.isFinite(displayQuantity) ||
    displayQuantity <= 0 ||
    displayQuantity > 1000000
  ) {
    redirect("/today?error=waste");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/today?error=store");

  await assertEmployeePermission(
    employee.id,
    "inventory.waste",
    employee.homeStoreId,
  );

  const inventory = await getInventoryIntelligence(
    employee.organizationId,
  );
  const row = inventory.smartRows.find(
    (item) => item.variantExternalId === variantExternalId,
  );
  if (!row) redirect("/today?error=waste-item");

  const displayFactor = row.displayFactor ?? 1;
  if (!Number.isFinite(displayFactor) || displayFactor <= 0) {
    redirect("/today?error=waste-unit");
  }
  const quantity = displayQuantity / displayFactor;
  const displayUnit =
    row.displayUnit ??
    (row.unitLabel === "peso/volumen" ? "u. Loyverse" : row.unitLabel);

  const db = getDb();
  const [created] = await db
    .insert(operationalEvents)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      eventType: reason === "REMAKE" ? "REMAKE" : "WASTE",
      severity:
        quantity >= Math.max(1, row.avgDailyUsage14 * 0.2)
          ? "IMPORTANT"
          : "NORMAL",
      variantExternalId,
      itemNameSnapshot: row.itemName,
      quantity: String(quantity),
      unitLabel: row.unitLabel,
      displayQuantity: String(displayQuantity),
      displayUnit,
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
    action:
      reason === "REMAKE"
        ? "BAR_REMAKE_REPORTED"
        : "BAR_WASTE_REPORTED",
    entityType: "operational_event",
    entityId: created.id,
    afterData: {
      variantExternalId,
      itemName: row.itemName,
      quantity,
      nativeUnitLabel: row.unitLabel,
      displayQuantity,
      displayUnit,
      reason,
      note,
    },
  });

  revalidatePath("/today");
  revalidatePath("/inventory");
  revalidatePath("/admin/decision-center");
  redirect("/today?saved=waste");
}

export async function reportQuickStockCount(formData: FormData) {
  const variantExternalId = String(
    formData.get("variantExternalId") ?? "",
  ).trim();
  const physicalDisplayQuantity = Number(
    formData.get("physicalQuantity"),
  );
  const note = String(formData.get("note") ?? "").trim() || null;

  if (
    !variantExternalId ||
    !Number.isFinite(physicalDisplayQuantity) ||
    physicalDisplayQuantity < 0 ||
    physicalDisplayQuantity > 1000000
  ) {
    redirect("/today?error=stock-count");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/today?error=store");

  await assertEmployeePermission(
    employee.id,
    "inventory.count",
    employee.homeStoreId,
  );

  const inventory = await getInventoryIntelligence(
    employee.organizationId,
  );
  const row = inventory.smartRows.find(
    (item) => item.variantExternalId === variantExternalId,
  );
  if (!row) redirect("/today?error=stock-count-item");

  const displayFactor = row.displayFactor ?? 1;
  if (!Number.isFinite(displayFactor) || displayFactor <= 0) {
    redirect("/today?error=stock-count-unit");
  }

  const sourceDisplayQuantity = row.inStock * displayFactor;
  const nativePhysicalQuantity =
    physicalDisplayQuantity / displayFactor;
  const displayUnit =
    row.displayUnit ??
    (row.unitLabel === "peso/volumen"
      ? "u. Loyverse"
      : row.unitLabel);

  const differenceDisplay =
    physicalDisplayQuantity - sourceDisplayQuantity;
  const toleranceDisplay = row.soldByWeight
    ? Math.max(0.01, Math.abs(sourceDisplayQuantity) * 0.02)
    : 0.49;
  const hasDiscrepancy =
    Math.abs(differenceDisplay) > toleranceDisplay;
  const now = new Date();
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    await tx
      .update(operationalEvents)
      .set({
        resolvedAt: now,
        resolvedByEmployeeId: employee.id,
      })
      .where(
        and(
          eq(
            operationalEvents.organizationId,
            employee.organizationId,
          ),
          eq(operationalEvents.storeId, employee.homeStoreId!),
          eq(operationalEvents.eventType, "STOCK_COUNT"),
          eq(
            operationalEvents.variantExternalId,
            variantExternalId,
          ),
          isNull(operationalEvents.resolvedAt),
        ),
      );

    const [event] = await tx
      .insert(operationalEvents)
      .values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId,
        employeeId: employee.id,
        eventType: "STOCK_COUNT",
        severity: hasDiscrepancy ? "IMPORTANT" : "NORMAL",
        variantExternalId,
        itemNameSnapshot: row.itemName,
        quantity: String(nativePhysicalQuantity),
        unitLabel: row.unitLabel,
        displayQuantity: String(physicalDisplayQuantity),
        displayUnit,
        note:
          "Conteo físico · Loyverse al contar " +
          sourceDisplayQuantity.toFixed(3) +
          " " +
          displayUnit +
          " · diferencia " +
          (differenceDisplay >= 0 ? "+" : "") +
          differenceDisplay.toFixed(3) +
          " " +
          displayUnit +
          (note ? " · " + note : ""),
        resolvedAt: hasDiscrepancy ? null : now,
        resolvedByEmployeeId: hasDiscrepancy
          ? null
          : employee.id,
      })
      .returning({ id: operationalEvents.id });

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "LOYVERSE_STOCK_COUNT_RECORDED",
      entityType: "operational_event",
      entityId: event.id,
      afterData: {
        variantExternalId,
        itemName: row.itemName,
        sourceNativeQuantity: row.inStock,
        sourceDisplayQuantity,
        physicalNativeQuantity: nativePhysicalQuantity,
        physicalDisplayQuantity,
        displayUnit,
        differenceDisplay,
        toleranceDisplay,
        requiresAdminReconciliation: hasDiscrepancy,
        note,
      },
    });

    return event;
  });

  revalidatePath("/today");
  revalidatePath("/inventory");
  revalidatePath("/admin/decision-center");
  redirect(
    "/today?saved=stock-count&count=" +
      created.id +
      (hasDiscrepancy ? "&reconcile=1" : ""),
  );
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
