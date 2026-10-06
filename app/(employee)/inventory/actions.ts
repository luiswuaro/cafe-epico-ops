"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, inventoryItems, shortageReports } from "@/src/infrastructure/db/schema";

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
