"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, inventoryItems, inventoryLocations, inventoryMovements, shortageReports } from "@/src/infrastructure/db/schema";
import { postInventoryMovement } from "@/src/application/inventory/post-movement";

const reportSchema = z.object({
  itemName: z.string().trim().min(1).max(150),
  quantityNeeded: z.string().trim().optional(),
  unit: z.enum(["g", "ml", "pz"]).optional(),
  priority: z.enum(["NORMAL", "URGENT"]),
  note: z.string().trim().max(500).optional(),
});

export async function reportShortage(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");
  await assertEmployeePermission(
    employee.id,
    "inventory.shortage.report",
    employee.homeStoreId,
  );

  const rawQuantity = String(formData.get("quantityNeeded") ?? "").trim();
  const rawUnit = String(formData.get("unit") ?? "").trim();

  const parsed = reportSchema.safeParse({
    itemName: String(formData.get("itemName") ?? ""),
    quantityNeeded: rawQuantity || undefined,
    unit: rawUnit ? rawUnit : undefined,
    priority: String(formData.get("priority") ?? "NORMAL"),
    note: String(formData.get("note") ?? "") || undefined,
  });

  if (!parsed.success) throw new Error("Datos de faltante inválidos");

  let quantityNeeded: string | null = null;
  if (parsed.data.quantityNeeded) {
    const quantity = Number(parsed.data.quantityNeeded);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("La cantidad debe ser mayor que cero");
    }
    quantityNeeded = String(quantity);
  }

  const db = getDb();
  const [created] = await db
    .insert(shortageReports)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      reportedBy: employee.id,
      itemName: parsed.data.itemName,
      quantityNeeded,
      unit: parsed.data.unit ?? null,
      priority: parsed.data.priority,
      note: parsed.data.note || null,
    })
    .returning({ id: shortageReports.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "SHORTAGE_REPORTED",
    entityType: "shortage_report",
    entityId: created.id,
    afterData: {
      itemName: parsed.data.itemName,
      quantityNeeded,
      unit: parsed.data.unit ?? null,
      priority: parsed.data.priority,
      note: parsed.data.note || null,
    },
  });

  revalidatePath("/inventory");
  revalidatePath("/today");
}

export async function resolveShortage(formData: FormData) {
  const shortageId = String(formData.get("shortageId") ?? "");
  if (!shortageId) throw new Error("Missing shortageId");

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");
  await assertEmployeePermission(
    employee.id,
    "inventory.shortage.resolve",
    employee.homeStoreId,
  );

  const db = getDb();
  const [shortage] = await db
    .select()
    .from(shortageReports)
    .where(
      and(
        eq(shortageReports.id, shortageId),
        eq(shortageReports.organizationId, employee.organizationId),
        eq(shortageReports.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!shortage) throw new Error("Faltante no encontrado");
  if (shortage.status === "RESOLVED") return;

  const resolvedAt = new Date();
  await db
    .update(shortageReports)
    .set({
      status: "RESOLVED",
      resolvedBy: employee.id,
      resolvedAt,
      updatedAt: resolvedAt,
    })
    .where(eq(shortageReports.id, shortageId));

  await db.insert(auditEvents).values({
    organizationId: shortage.organizationId,
    storeId: shortage.storeId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "SHORTAGE_RESOLVED",
    entityType: "shortage_report",
    entityId: shortage.id,
    beforeData: { status: shortage.status },
    afterData: { status: "RESOLVED" },
  });

  revalidatePath("/inventory");
  revalidatePath("/today");
}


const inventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sku: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1).max(80),
  canonicalUnit: z.enum(["g", "ml", "pz"]),
  minimumStock: z.string().trim().optional(),
});

export async function createInventoryItem(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");

  await assertEmployeePermission(
    employee.id,
    "inventory.item.manage",
    employee.homeStoreId,
  );

  const parsed = inventoryItemSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    sku: String(formData.get("sku") ?? "").trim() || undefined,
    category: String(formData.get("category") ?? ""),
    canonicalUnit: String(formData.get("canonicalUnit") ?? ""),
    minimumStock: String(formData.get("minimumStock") ?? "").trim() || undefined,
  });

  if (!parsed.success) throw new Error("Datos de insumo inválidos");

  let minimumStock: string | null = null;
  if (parsed.data.minimumStock) {
    const value = Number(parsed.data.minimumStock);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("El stock mínimo no puede ser negativo");
    }
    minimumStock = String(value);
  }

  const db = getDb();
  const [created] = await db
    .insert(inventoryItems)
    .values({
      organizationId: employee.organizationId,
      name: parsed.data.name,
      sku: parsed.data.sku ?? null,
      category: parsed.data.category,
      canonicalUnit: parsed.data.canonicalUnit,
      minimumStock,
      trackingType: "QUANTITY",
      isActive: true,
    })
    .returning({ id: inventoryItems.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_ITEM_CREATED",
    entityType: "inventory_item",
    entityId: created.id,
    afterData: {
      name: parsed.data.name,
      sku: parsed.data.sku ?? null,
      category: parsed.data.category,
      canonicalUnit: parsed.data.canonicalUnit,
      minimumStock,
    },
  });

  revalidatePath("/inventory");
}


const openingBalanceSchema = z.object({
  locationId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  quantity: z.coerce.number().min(0).max(1_000_000_000),
  note: z.string().trim().max(500).optional(),
});

export async function setOpeningInventoryBalance(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Employee has no home store");

  await assertEmployeePermission(
    employee.id,
    "inventory.adjust",
    employee.homeStoreId,
  );

  const parsed = openingBalanceSchema.safeParse({
    locationId: String(formData.get("locationId") ?? ""),
    inventoryItemId: String(formData.get("inventoryItemId") ?? ""),
    quantity: formData.get("quantity"),
    note: String(formData.get("note") ?? "") || undefined,
  });

  if (!parsed.success) throw new Error("Inventario inicial inválido");

  const db = getDb();

  const [[location], [item], [existingMovement]] = await Promise.all([
    db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(
        and(
          eq(inventoryLocations.id, parsed.data.locationId),
          eq(inventoryLocations.organizationId, employee.organizationId),
          eq(inventoryLocations.storeId, employee.homeStoreId),
          eq(inventoryLocations.isActive, true),
        ),
      )
      .limit(1),
    db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        canonicalUnit: inventoryItems.canonicalUnit,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, parsed.data.inventoryItemId),
          eq(inventoryItems.organizationId, employee.organizationId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .limit(1),
    db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.storeId, employee.homeStoreId),
          eq(inventoryMovements.locationId, parsed.data.locationId),
          eq(inventoryMovements.inventoryItemId, parsed.data.inventoryItemId),
        ),
      )
      .limit(1),
  ]);

  if (!location || !item) throw new Error("Insumo o ubicación inválida");

  if (existingMovement) {
    throw new Error(
      "Este insumo ya tiene movimientos en esa ubicación. Usa un ajuste controlado, no otro saldo inicial.",
    );
  }

  const movement = await postInventoryMovement({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    locationId: parsed.data.locationId,
    inventoryItemId: parsed.data.inventoryItemId,
    movementType: "OPENING_BALANCE",
    quantityDelta: String(parsed.data.quantity),
    sourceType: "MANUAL_OPENING_BALANCE",
    occurredAt: new Date(),
    employeeId: employee.id,
    note: parsed.data.note ?? "Inventario inicial",
  });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "INVENTORY_OPENING_BALANCE_SET",
    entityType: "inventory_movement",
    entityId: movement.id,
    afterData: {
      inventoryItemId: item.id,
      itemName: item.name,
      locationId: location.id,
      quantity: parsed.data.quantity,
      unit: item.canonicalUnit,
    },
  });

  revalidatePath("/inventory");
  revalidatePath("/inventory/counts");
}
