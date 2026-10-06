"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  syncLoyverseCustomers,
  syncLoyverseInventory,
  syncLoyverseItems,
  syncLoyverseReceipts,
  syncLoyverseStores,
} from "@/src/application/loyverse/sync";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  integrationConnections,
} from "@/src/infrastructure/db/schema";

const resourceSchema = z.enum([
  "stores",
  "items",
  "inventory",
  "customers",
  "receipts30",
  "receipts90",
]);

export async function runLoyverseSync(formData: FormData) {
  const resource = resourceSchema.parse(
    String(formData.get("resource") ?? ""),
  );

  const { user, employeeId, organizationId } =
    await requirePermission("integration.manage");

  if (!process.env.LOYVERSE_ACCESS_TOKEN) {
    throw new Error("LOYVERSE_ACCESS_TOKEN no está configurado");
  }

  const db = getDb();
  const startedAt = new Date();

  try {
    let records = 0;
    let since: string | null = null;

    switch (resource) {
      case "stores":
        records = await syncLoyverseStores();
        break;
      case "items":
        records = await syncLoyverseItems();
        break;
      case "inventory":
        records = await syncLoyverseInventory();
        break;
      case "customers":
        records = await syncLoyverseCustomers();
        break;
      case "receipts30":
        since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        records = await syncLoyverseReceipts(since);
        break;
      case "receipts90":
        since = new Date(Date.now() - 90 * 86_400_000).toISOString();
        records = await syncLoyverseReceipts(since);
        break;
    }

    await db
      .update(integrationConnections)
      .set({ status: "CONNECTED", updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.organizationId, organizationId),
          eq(integrationConnections.provider, "LOYVERSE"),
        ),
      );

    await db.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "LOYVERSE_SYNC_COMPLETED",
      entityType: "integration_connection",
      entityId: "LOYVERSE",
      afterData: {
        resource,
        records,
        since,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    await db
      .update(integrationConnections)
      .set({ status: "ERROR", updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.organizationId, organizationId),
          eq(integrationConnections.provider, "LOYVERSE"),
        ),
      );

    await db.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "LOYVERSE_SYNC_FAILED",
      entityType: "integration_connection",
      entityId: "LOYVERSE",
      afterData: {
        resource,
        error: error instanceof Error ? error.message : "unknown",
        startedAt: startedAt.toISOString(),
      },
    });

    throw error;
  }

  revalidatePath("/admin/integrations");
}
