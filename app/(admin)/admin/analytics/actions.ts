"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents } from "@/src/infrastructure/db/schema";
import {
  loyverseReceiptWindowStart,
  syncLoyverseCustomers,
  syncLoyverseReceipts,
} from "@/src/application/loyverse/sync";

export async function refreshAnalytics() {
  const { user, employeeId, organizationId } =
    await requirePermission("integration.manage");

  let receipts = 0;
  let customers = 0;

  try {
    const since = loyverseReceiptWindowStart(30);
    [receipts, customers] = await Promise.all([
      syncLoyverseReceipts(since),
      syncLoyverseCustomers(),
    ]);

    await getDb().insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "ANALYTICS_DATA_REFRESHED",
      entityType: "loyverse_analytics",
      entityId: "rolling-30d",
      afterData: { receipts, customers },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    redirect(
      `/admin/analytics?error=${encodeURIComponent(message)}`,
    );
  }

  revalidatePath("/admin/analytics");
  redirect(
    `/admin/analytics?refreshed=1&receipts=${receipts}&customers=${customers}`,
  );
}
