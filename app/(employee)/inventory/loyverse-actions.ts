"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  syncLoyverseCategories,
  syncLoyverseInventory,
  syncLoyverseItems,
  syncLoyverseReceipts,
} from "@/src/application/loyverse/sync";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents } from "@/src/infrastructure/db/schema";

export async function refreshLoyverseInventorySource() {
  const { user, employeeId, organizationId } =
    await requirePermission("integration.manage");

  let categories = 0;
  let items = 0;
  let inventory = 0;
  let receipts = 0;

  try {
    categories = await syncLoyverseCategories();
    items = await syncLoyverseItems();
    inventory = await syncLoyverseInventory();
    const receiptSince = new Date(
      Date.now() - 35 * 86_400_000,
    ).toISOString();
    receipts = await syncLoyverseReceipts(receiptSince);

    await getDb().insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "LOYVERSE_SOURCE_REFRESHED",
      entityType: "loyverse_inventory",
      entityId: "current",
      afterData: { categories, items, inventory, receipts },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    redirect("/inventory?error=" + encodeURIComponent(message));
  }

  revalidatePath("/inventory");
  revalidatePath("/admin/loyverse");
  revalidatePath("/admin/loyverse/inventory");
  revalidatePath("/admin/loyverse/recipes");
  redirect(
    "/inventory?refreshed=1&items=" +
      items +
      "&levels=" +
      inventory +
      "&categories=" +
      categories +
      "&receipts=" +
      receipts,
  );
}