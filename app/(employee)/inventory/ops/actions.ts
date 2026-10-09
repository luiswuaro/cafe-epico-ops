"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, inventoryBalances, inventoryItems, inventoryLocations, inventoryMovements } from "@/src/infrastructure/db/schema";

const schema = z.object({
  operationId: z.string().uuid(),
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  operation: z.enum(["PURCHASE", "WASTE", "CONSUMPTION", "COUNT_ADJUSTMENT"]),
  quantity: z.coerce.number().finite().min(0).max(10000000),
  reason: z.string().trim().min(3).max(500),
});

export async function registerOpsInventoryMovement(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("No hay sucursal operativa.");
  await assertEmployeePermission(employee.id, "inventory.adjust", employee.homeStoreId);
  const result = schema.safeParse({
    operationId: formData.get("operationId"),
    itemId: formData.get("itemId"),
    locationId: formData.get("locationId"),
    operation: formData.get("operation"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
  });
  if (!result.success) throw new Error("Movimiento inválido. Revisa artículo, cantidad y motivo.");
  const { operationId, itemId, locationId, operation, quantity, reason } = result.data;
  if (operation !== "COUNT_ADJUSTMENT" && quantity <= 0) {
    throw new Error("La cantidad de entrada o salida debe ser mayor que cero.");
  }
  if (Math.abs(Math.round(quantity * 1000) - quantity * 1000) > 0.00001) {
    throw new Error("Máximo tres decimales para las cantidades.");
  }
  const db = getDb();
  const movementId = await db.transaction(async (tx) => {
    // El mismo candado se utiliza al cobrar LIVE, impidiendo pérdidas de actualización.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [duplicate] = await tx.select({ id: inventoryMovements.id })
      .from(inventoryMovements).where(and(
        eq(inventoryMovements.organizationId, employee.organizationId),
        eq(inventoryMovements.externalProvider, "OPS_MANUAL"),
        eq(inventoryMovements.externalId, operationId),
      )).limit(1);
    if (duplicate) return duplicate.id;

    const [[item], [location], [balance]] = await Promise.all([
      tx.select({id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.canonicalUnit})
        .from(inventoryItems).where(and(
          eq(inventoryItems.id, itemId),
          eq(inventoryItems.organizationId, employee.organizationId),
          eq(inventoryItems.isActive, true),
          eq(inventoryItems.trackingType, "QUANTITY"),
        )).limit(1),
      tx.select({id: inventoryLocations.id}).from(inventoryLocations).where(and(
        eq(inventoryLocations.id, locationId),
        eq(inventoryLocations.organizationId, employee.organizationId),
        eq(inventoryLocations.storeId, employee.homeStoreId!),
        eq(inventoryLocations.isActive, true),
      )).limit(1),
      tx.select().from(inventoryBalances).where(and(
        eq(inventoryBalances.organizationId, employee.organizationId),
        eq(inventoryBalances.storeId, employee.homeStoreId!),
        eq(inventoryBalances.locationId, locationId),
        eq(inventoryBalances.inventoryItemId, itemId),
      )).for("update").limit(1),
    ]);
    if (!item || !location || !balance) {
      throw new Error("Primero confirma el saldo inicial del insumo en esa ubicación.");
    }
    const previous = Number(balance.theoreticalQuantity);
    let delta = operation === "COUNT_ADJUSTMENT" ? quantity - previous :
      operation === "PURCHASE" ? quantity : -quantity;
    delta = Math.round(delta * 1000) / 1000;
    if (!Number.isFinite(delta)) throw new Error("Cantidad inválida.");
    if (previous + delta < -0.000001) throw new Error(
      "No puedes registrar una salida mayor que las existencias disponibles."
    );
    if (Math.abs(delta) < 0.0005) return null;

    const movementType = operation === "PURCHASE" ? "PURCHASE" :
      operation === "WASTE" ? "WASTE" :
      operation === "COUNT_ADJUSTMENT" ? "COUNT_ADJUSTMENT" : "MANUAL_ADJUSTMENT";
    const now = new Date();
    const [movement] = await tx.insert(inventoryMovements).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId!,
      locationId,
      inventoryItemId: itemId,
      movementType,
      quantityDelta: delta.toFixed(3),
      sourceType: "OPS_STOCK_MANUAL",
      sourceId: operationId,
      occurredAt: now,
      employeeId: employee.id,
      note: operation + ": " + reason,
      externalProvider: "OPS_MANUAL",
      externalId: operationId,
    }).returning({id: inventoryMovements.id});
    await tx.update(inventoryBalances).set({
      theoreticalQuantity: (previous + delta).toFixed(3),
      updatedAt: now,
    }).where(and(
      eq(inventoryBalances.organizationId, employee.organizationId),
      eq(inventoryBalances.storeId, employee.homeStoreId!),
      eq(inventoryBalances.locationId, locationId),
      eq(inventoryBalances.inventoryItemId, itemId),
    ));
    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId!,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "OPS_INVENTORY_MANUAL_MOVEMENT",
      entityType: "inventory_movement",
      entityId: movement.id,
      beforeData: {itemId, locationId, name: item.name, quantity: previous, unit: item.unit},
      afterData: {operation, delta, quantity: previous + delta, inputQuantity: quantity, reason, unit: item.unit},
    });
    return movement.id;
  });
  // La acción redirige tras confirmar la transacción; no se reenvía al recargar.
  redirect("/inventory/ops?posted=" + (movementId ? encodeURIComponent(movementId) : "nochange"));
}
