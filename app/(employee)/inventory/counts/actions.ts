"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTheoreticalBalance } from "@/src/application/inventory/post-movement";
import { deviation } from "@/src/domain/inventory/types";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  inventoryCountLines,
  inventoryCounts,
  inventoryItems,
  inventoryLocations,
} from "@/src/infrastructure/db/schema";

export async function startInventoryCount(formData: FormData) {
  const locationId = String(formData.get("locationId") ?? "");
  if (!locationId) throw new Error("Selecciona una ubicación");

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");
  await assertEmployeePermission(
    employee.id,
    "inventory.count",
    employee.homeStoreId,
  );

  const db = getDb();
  const [location] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        eq(inventoryLocations.id, locationId),
        eq(inventoryLocations.organizationId, employee.organizationId),
        eq(inventoryLocations.storeId, employee.homeStoreId),
        eq(inventoryLocations.isActive, true),
      ),
    )
    .limit(1);

  if (!location) throw new Error("Ubicación inválida");

  const [existing] = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    .where(
      and(
        eq(inventoryCounts.organizationId, employee.organizationId),
        eq(inventoryCounts.storeId, employee.homeStoreId),
        eq(inventoryCounts.locationId, locationId),
        eq(inventoryCounts.status, "OPEN"),
      ),
    )
    .limit(1);

  if (existing) redirect(`/inventory/counts/${existing.id}`);

  const [created] = await db
    .insert(inventoryCounts)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      locationId,
      status: "OPEN",
      startedBy: employee.id,
    })
    .returning({ id: inventoryCounts.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_COUNT_STARTED",
    entityType: "inventory_count",
    entityId: created.id,
    afterData: { locationId },
  });

  redirect(`/inventory/counts/${created.id}`);
}

export async function saveInventoryCountLine(formData: FormData) {
  const countId = String(formData.get("countId") ?? "");
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "");
  const physicalRaw = String(formData.get("physicalQuantity") ?? "").trim();

  const physical = Number(physicalRaw);
  if (!countId || !inventoryItemId || !Number.isFinite(physical) || physical < 0) {
    throw new Error("Datos de conteo inválidos");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");
  await assertEmployeePermission(
    employee.id,
    "inventory.count",
    employee.homeStoreId,
  );

  const db = getDb();
  const [count] = await db
    .select()
    .from(inventoryCounts)
    .where(
      and(
        eq(inventoryCounts.id, countId),
        eq(inventoryCounts.organizationId, employee.organizationId),
        eq(inventoryCounts.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!count || count.status !== "OPEN") {
    throw new Error("El conteo no está abierto");
  }

  const [item] = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      unit: inventoryItems.canonicalUnit,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, inventoryItemId),
        eq(inventoryItems.organizationId, employee.organizationId),
        eq(inventoryItems.isActive, true),
      ),
    )
    .limit(1);

  if (!item) throw new Error("Insumo inválido");

  const theoreticalRaw = await getTheoreticalBalance(
    count.storeId,
    count.locationId,
    inventoryItemId,
  );
  const theoretical = Number(theoreticalRaw);
  const diff = deviation(physical, theoretical);
  const countedAt = new Date();

  await db
    .insert(inventoryCountLines)
    .values({
      organizationId: employee.organizationId,
      inventoryCountId: count.id,
      inventoryItemId,
      theoreticalQuantitySnapshot: String(theoretical),
      physicalQuantity: String(physical),
      deviationQuantity: String(diff.quantity),
      deviationPercentage:
        diff.percentage == null ? null : String(diff.percentage),
      countedBy: employee.id,
      countedAt,
    })
    .onConflictDoUpdate({
      target: [
        inventoryCountLines.inventoryCountId,
        inventoryCountLines.inventoryItemId,
      ],
      set: {
        theoreticalQuantitySnapshot: String(theoretical),
        physicalQuantity: String(physical),
        deviationQuantity: String(diff.quantity),
        deviationPercentage:
          diff.percentage == null ? null : String(diff.percentage),
        countedBy: employee.id,
        countedAt,
      },
    });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_COUNT_LINE_RECORDED",
    entityType: "inventory_count",
    entityId: count.id,
    afterData: {
      inventoryItemId,
      itemName: item.name,
      unit: item.unit,
      theoretical,
      physical,
      deviation: diff.quantity,
    },
  });

  revalidatePath(`/inventory/counts/${countId}`);
}

export async function completeInventoryCount(formData: FormData) {
  const countId = String(formData.get("countId") ?? "");
  const confirmPartial = String(formData.get("confirmPartial") ?? "") === "yes";
  if (!countId) throw new Error("Missing countId");

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");
  await assertEmployeePermission(
    employee.id,
    "inventory.count",
    employee.homeStoreId,
  );

  const db = getDb();
  const [count] = await db
    .select()
    .from(inventoryCounts)
    .where(
      and(
        eq(inventoryCounts.id, countId),
        eq(inventoryCounts.organizationId, employee.organizationId),
        eq(inventoryCounts.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!count) throw new Error("Conteo no encontrado");
  if (count.status === "COMPLETED") redirect(`/inventory/counts/${count.id}`);

  const [[coverage], [catalog]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, count.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, employee.organizationId),
          eq(inventoryItems.isActive, true),
        ),
      ),
  ]);

  const countedItems = coverage?.count ?? 0;
  const catalogItems = catalog?.count ?? 0;

  if (countedItems === 0) {
    throw new Error("Registra al menos un insumo antes de cerrar");
  }

  const partial = catalogItems > 0 && countedItems < catalogItems;
  if (partial && !confirmPartial) {
    throw new Error("Confirma explícitamente que deseas cerrar un conteo parcial");
  }

  const completedAt = new Date();
  await db
    .update(inventoryCounts)
    .set({
      status: "COMPLETED",
      completedBy: employee.id,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(inventoryCounts.id, count.id));

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_COUNT_COMPLETED",
    entityType: "inventory_count",
    entityId: count.id,
    afterData: {
      locationId: count.locationId,
      countedItems,
      catalogItems,
      partial,
      note: "No stock adjustment generated automatically",
    },
  });

  revalidatePath("/inventory/counts");
  revalidatePath(`/inventory/counts/${count.id}`);
  redirect(`/inventory/counts/${count.id}`);
}
