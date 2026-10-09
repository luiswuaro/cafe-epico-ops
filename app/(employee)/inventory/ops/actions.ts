"use server";

import { and, eq, sql, ilike } from "drizzle-orm";
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
  const rawQuantity=String(formData.get("quantity")??"").trim();
  if(!rawQuantity) throw new Error("Escribe la cantidad; una casilla vacía nunca se interpreta como cero.");
  const result = schema.safeParse({
    operationId: formData.get("operationId"),
    itemId: formData.get("itemId"),
    locationId: formData.get("locationId"),
    operation: formData.get("operation"),
    quantity: rawQuantity,
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

const newItemSchema = z.object({
  operationId: z.string().uuid(),
  locationId: z.string().uuid(),
  name: z.string().trim().min(2).max(150),
  sku: z.string().trim().max(80).optional(),
  category: z.string().trim().min(2).max(80),
  unit: z.enum(["g", "ml", "pz"]),
  initialQuantity: z.coerce.number().finite().min(0).max(10000000),
  note: z.string().trim().min(3).max(500),
});

export async function createOpsInventoryItem(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id, "inventory.item.manage", employee.homeStoreId);
  await assertEmployeePermission(employee.id, "inventory.adjust", employee.homeStoreId);
  const rawInitial=String(formData.get("initialQuantity")??"").trim();
  if(!rawInitial) throw new Error("Confirma el saldo inicial, incluso cuando sea cero.");
  const parsed = newItemSchema.safeParse({
    operationId: formData.get("operationId"),
    locationId: formData.get("locationId"),
    name: formData.get("name"),
    sku: String(formData.get("sku") ?? "").trim() || undefined,
    category: formData.get("category"),
    unit: formData.get("unit"),
    initialQuantity: rawInitial,
    note: formData.get("note"),
  });
  if (!parsed.success) throw new Error("Alta inválida: revisa nombre, ubicación, unidad y saldo.");
  const data = parsed.data;
  if (Math.abs(Math.round(data.initialQuantity*1000)-data.initialQuantity*1000)>0.00001)
    throw new Error("Cantidad inicial: máximo tres decimales.");
  const db = getDb();
  const itemId = await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [sameOperation] = await tx.select({ inventoryItemId: inventoryMovements.inventoryItemId })
      .from(inventoryMovements).where(and(
        eq(inventoryMovements.organizationId, employee.organizationId),
        eq(inventoryMovements.externalProvider, "OPS_NEW_ITEM"),
        eq(inventoryMovements.externalId, data.operationId),
      )).limit(1);
    if(sameOperation) return sameOperation.inventoryItemId;
    const [location] = await tx.select({id: inventoryLocations.id}).from(inventoryLocations)
      .where(and(eq(inventoryLocations.id,data.locationId),
        eq(inventoryLocations.storeId,employee.homeStoreId!),
        eq(inventoryLocations.organizationId,employee.organizationId),
        eq(inventoryLocations.isActive,true))).limit(1);
    if(!location) throw new Error("Ubicación no válida.");
    const [existing] = await tx.select({id:inventoryItems.id}).from(inventoryItems)
      .where(and(eq(inventoryItems.organizationId,employee.organizationId),
        ilike(inventoryItems.name,data.name))).limit(1);
    if(existing) throw new Error("Ya existe un insumo con ese nombre. Evita duplicarlo.");
    const now = new Date();
    const [item]=await tx.insert(inventoryItems).values({
      organizationId:employee.organizationId,name:data.name,sku:data.sku??null,
      category:data.category,canonicalUnit:data.unit,trackingType:"QUANTITY",
    }).returning({id:inventoryItems.id});
    await tx.insert(inventoryBalances).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      locationId:data.locationId,inventoryItemId:item.id,
      theoreticalQuantity:data.initialQuantity.toFixed(3),
    });
    if(data.initialQuantity>0){
      await tx.insert(inventoryMovements).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId!,
        locationId:data.locationId,inventoryItemId:item.id,
        movementType:"OPENING_BALANCE",quantityDelta:data.initialQuantity.toFixed(3),
        sourceType:"OPS_ITEM_INITIAL",sourceId:data.operationId,occurredAt:now,
        employeeId:employee.id,note:data.note,
        externalProvider:"OPS_NEW_ITEM",externalId:data.operationId,
      });
    }
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"OPS_INVENTORY_ITEM_CREATED",entityType:"inventory_item",entityId:item.id,
      afterData:{name:data.name,unit:data.unit,category:data.category,initial:data.initialQuantity,note:data.note},
    });
    return item.id;
  });
  redirect("/inventory/ops?created="+encodeURIComponent(itemId));
}
