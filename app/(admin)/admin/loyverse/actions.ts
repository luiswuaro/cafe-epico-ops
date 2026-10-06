"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  integrationConnections,
  syncRuns,
  syncStates,
} from "@/src/infrastructure/db/schema";
import {
  syncLoyverseCustomers,
  syncLoyverseInventory,
  syncLoyverseItems,
  syncLoyverseReceipts,
  syncLoyverseStores,
} from "@/src/application/loyverse/sync";

const resourceSchema = z.enum([
  "stores",
  "items",
  "inventory",
  "customers",
  "receipts30",
]);

export async function runLoyverseSync(formData: FormData) {
  const parsed = resourceSchema.safeParse(String(formData.get("resource") ?? ""));
  if (!parsed.success) redirect("/admin/loyverse?error=Recurso%20inv%C3%A1lido");

  const resource = parsed.data;
  const { user, employeeId, organizationId } =
    await requirePermission("integration.manage");
  const db = getDb();

  const [connection] = await db
    .insert(integrationConnections)
    .values({
      organizationId,
      provider: "LOYVERSE",
      status: "RUNNING",
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.organizationId,
        integrationConnections.provider,
      ],
      set: { status: "RUNNING", updatedAt: new Date() },
    })
    .returning({ id: integrationConnections.id });

  const startedAt = new Date();
  const [run] = await db
    .insert(syncRuns)
    .values({
      integrationConnectionId: connection.id,
      resource,
      status: "RUNNING",
      startedAt,
    })
    .returning({ id: syncRuns.id });

  await db
    .insert(syncStates)
    .values({
      integrationConnectionId: connection.id,
      resource,
      status: "RUNNING",
      lastAttemptAt: startedAt,
    })
    .onConflictDoUpdate({
      target: [syncStates.integrationConnectionId, syncStates.resource],
      set: {
        status: "RUNNING",
        lastAttemptAt: startedAt,
        errorMessage: null,
        updatedAt: startedAt,
      },
    });

  let count = 0;
  let errorMessage: string | null = null;

  try {
    if (resource === "stores") count = await syncLoyverseStores();
    if (resource === "items") count = await syncLoyverseItems();
    if (resource === "inventory") count = await syncLoyverseInventory();
    if (resource === "customers") count = await syncLoyverseCustomers();
    if (resource === "receipts30") {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      count = await syncLoyverseReceipts(since);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Error desconocido";
  }

  const completedAt = new Date();

  if (errorMessage) {
    await db.transaction(async (tx) => {
      await tx
        .update(syncRuns)
        .set({
          status: "FAILED",
          completedAt,
          recordsFailed: 1,
          error: errorMessage,
        })
        .where(eq(syncRuns.id, run.id));

      await tx
        .update(syncStates)
        .set({
          status: "FAILED",
          lastAttemptAt: completedAt,
          errorMessage,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(syncStates.integrationConnectionId, connection.id),
            eq(syncStates.resource, resource),
          ),
        );

      await tx
        .update(integrationConnections)
        .set({ status: "ERROR", updatedAt: completedAt })
        .where(eq(integrationConnections.id, connection.id));

      await tx.insert(auditEvents).values({
        organizationId,
        actorUserId: user.id,
        actorEmployeeId: employeeId,
        action: "LOYVERSE_SYNC_FAILED",
        entityType: "integration_connection",
        entityId: connection.id,
        afterData: { resource, error: errorMessage },
      });
    });

    redirect(
      `/admin/loyverse?error=${encodeURIComponent(
        `${resource}: ${errorMessage}`,
      )}`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(syncRuns)
      .set({
        status: "SUCCESS",
        completedAt,
        recordsRead: count,
      })
      .where(eq(syncRuns.id, run.id));

    await tx
      .update(syncStates)
      .set({
        status: "SUCCESS",
        lastAttemptAt: completedAt,
        lastSuccessfulSyncAt: completedAt,
        errorMessage: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(syncStates.integrationConnectionId, connection.id),
          eq(syncStates.resource, resource),
        ),
      );

    await tx
      .update(integrationConnections)
      .set({ status: "CONNECTED", updatedAt: completedAt })
      .where(eq(integrationConnections.id, connection.id));

    await tx.insert(auditEvents).values({
      organizationId,
      actorUserId: user.id,
      actorEmployeeId: employeeId,
      action: "LOYVERSE_SYNC_COMPLETED",
      entityType: "integration_connection",
      entityId: connection.id,
      afterData: { resource, recordsRead: count },
    });
  });

  redirect(`/admin/loyverse?ok=${resource}&count=${count}`);
}
