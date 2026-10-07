"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getInventoryItemUnitDependencies } from "@/src/application/inventory/catalog-admin";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, inventoryItems } from "@/src/infrastructure/db/schema";

const editSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(150),
  sku: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1).max(80),
  canonicalUnit: z.enum(["g", "ml", "pz"]),
  minimumStock: z.string().trim().optional(),
});

export async function updateInventoryItem(formData: FormData) {
  const parsed = editSchema.safeParse({
    itemId: String(formData.get("itemId") ?? ""),
    name: String(formData.get("name") ?? ""),
    sku: String(formData.get("sku") ?? "").trim() || undefined,
    category: String(formData.get("category") ?? ""),
    canonicalUnit: String(formData.get("canonicalUnit") ?? ""),
    minimumStock:
      String(formData.get("minimumStock") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect("/admin/inventory/catalog?error=invalid");
  }

  const { employeeId, user, organizationId } =
    await requirePermission("inventory.item.manage");
  const db = getDb();

  const [before] = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, parsed.data.itemId),
        eq(inventoryItems.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!before) redirect("/admin/inventory/catalog?error=not-found");

  let minimumStock: string | null = null;
  if (parsed.data.minimumStock) {
    const n = Number(parsed.data.minimumStock);
    if (!Number.isFinite(n) || n < 0) {
      redirect("/admin/inventory/catalog?error=minimum");
    }
    minimumStock = String(n);
  }

  if (before.canonicalUnit !== parsed.data.canonicalUnit) {
    const deps = await getInventoryItemUnitDependencies(
      organizationId,
      before.id,
    );

    if (deps.total > 0) {
      redirect(
        `/admin/inventory/catalog?error=unit-in-use&item=${encodeURIComponent(
          before.name,
        )}`,
      );
    }
  }

  try {
    await db
      .update(inventoryItems)
      .set({
        name: parsed.data.name,
        sku: parsed.data.sku ?? null,
        category: parsed.data.category,
        canonicalUnit: parsed.data.canonicalUnit,
        minimumStock,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, before.id));
  } catch {
    redirect("/admin/inventory/catalog?error=duplicate-sku");
  }

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: "INVENTORY_ITEM_UPDATED",
    entityType: "inventory_item",
    entityId: before.id,
    beforeData: {
      name: before.name,
      sku: before.sku,
      category: before.category,
      canonicalUnit: before.canonicalUnit,
      minimumStock: before.minimumStock,
    },
    afterData: {
      name: parsed.data.name,
      sku: parsed.data.sku ?? null,
      category: parsed.data.category,
      canonicalUnit: parsed.data.canonicalUnit,
      minimumStock,
    },
  });

  revalidatePath("/inventory");
  revalidatePath("/admin/inventory/catalog");
  revalidatePath("/admin/loyverse/inventory");
  revalidatePath("/admin/loyverse/recipes");
  redirect("/admin/inventory/catalog?updated=1");
}

export async function toggleInventoryItem(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const { employeeId, user, organizationId } =
    await requirePermission("inventory.item.manage");

  const db = getDb();
  const [before] = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!before) return;

  await db
    .update(inventoryItems)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(inventoryItems.id, itemId));

  await db.insert(auditEvents).values({
    organizationId,
    actorUserId: user.id,
    actorEmployeeId: employeeId,
    action: active
      ? "INVENTORY_ITEM_REACTIVATED"
      : "INVENTORY_ITEM_DEACTIVATED",
    entityType: "inventory_item",
    entityId: itemId,
    beforeData: { isActive: before.isActive },
    afterData: { isActive: active },
  });

  revalidatePath("/inventory");
  revalidatePath("/admin/inventory/catalog");
}
