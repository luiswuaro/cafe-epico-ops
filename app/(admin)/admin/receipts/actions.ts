"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loyverseReceiptWindowStart,
  syncLoyverseReceipts,
} from "@/src/application/loyverse/sync";
import { requirePermission } from "@/src/infrastructure/auth/permissions";

export async function refreshLoyverseReceipts() {
  await requirePermission("integration.manage");

  let count = 0;
  try {
    count = await syncLoyverseReceipts(loyverseReceiptWindowStart(30));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al sincronizar recibos";
    redirect(
      "/admin/receipts?error=" + encodeURIComponent(message),
    );
  }

  revalidatePath("/admin/receipts");
  revalidatePath("/admin/analytics");
  redirect("/admin/receipts?synced=1&count=" + count);
}
