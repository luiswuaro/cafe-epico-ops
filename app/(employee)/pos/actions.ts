"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posOrderLines,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

const cartSchema = z
  .array(
    z.object({
      externalId: z.string().min(1),
      quantity: z.number().int().min(1).max(20),
    }),
  )
  .min(1)
  .max(30);

const serviceModeSchema = z.enum(["DINE_IN", "TAKEAWAY"]);
const paymentSchema = z.enum(["CASH", "CARD", "TRANSFER"]);

function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function folio(date: Date, clientOrderId: string) {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\D/g, "");
  return "SH-" + stamp + "-" + clientOrderId.slice(-4).toUpperCase();
}

export async function createShadowSale(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const rawCart = String(formData.get("cart") ?? "[]");
  const rawClientOrderId = String(formData.get("clientOrderId") ?? "").trim();
  const serviceMode = serviceModeSchema.parse(
    String(formData.get("serviceMode") ?? ""),
  );
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const tableLabel = String(formData.get("tableLabel") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  const parsedCart = cartSchema.parse(JSON.parse(rawCart));
  const catalog = await getPosCatalog(employee.organizationId);
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  const lines = parsedCart.map((line) => {
    const item = catalogById.get(line.externalId);
    if (!item) throw new Error("Producto no disponible en el catálogo POS");

    const lineTotal = item.price * line.quantity;
    const serviceRecipe =
      item.serviceRecipes[serviceMode as PosServiceMode];

    return {
      item,
      quantity: line.quantity,
      lineTotal,
      expectedConsumption: {
        mode: "SHADOW",
        serviceMode,
        sourceRecipeExternalId: serviceRecipe.externalId,
        sourceCategory: serviceRecipe.sourceCategory,
        components: serviceRecipe.effectiveComponents.map((component) => ({
          variantExternalId: component.variantExternalId,
          itemExternalId: component.itemExternalId,
          name: component.sourceName,
          quantity: component.quantity * line.quantity,
          unitLabel: component.unitLabel,
          category: component.category,
        })),
      },
    };
  });

  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const clientOrderId = rawClientOrderId || randomUUID();
  const now = new Date();
  const db = getDb();

  const [existing] = await db
    .select({ id: posOrders.id })
    .from(posOrders)
    .where(
      and(
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.clientOrderId, clientOrderId),
      ),
    )
    .limit(1);

  if (existing) {
    redirect("/pos?saved=" + existing.id + "&duplicate=1");
  }

  const order = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(posOrders)
      .values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId!,
        clientOrderId,
        folio: folio(now, clientOrderId),
        mode: "SHADOW",
        status: "PAID",
        serviceMode,
        tableLabel: serviceMode === "DINE_IN" ? tableLabel : null,
        employeeId: employee.id,
        businessDate: businessDate(now),
        subtotal: total.toFixed(2),
        total: total.toFixed(2),
        note,
        inventoryEffectApplied: false,
        paidAt: now,
      })
      .returning();

    await tx.insert(posOrderLines).values(
      lines.map((line) => ({
        organizationId: employee.organizationId,
        orderId: created.id,
        catalogExternalId: line.item.id,
        variantExternalId: line.item.variantExternalId,
        nameSnapshot: line.item.name,
        categorySnapshot: line.item.category,
        unitPrice: line.item.price.toFixed(2),
        quantity: String(line.quantity),
        lineTotal: line.lineTotal.toFixed(2),
        expectedConsumption: line.expectedConsumption,
      })),
    );

    await tx.insert(posPayments).values({
      organizationId: employee.organizationId,
      orderId: created.id,
      method: paymentMethod,
      amount: total.toFixed(2),
    });

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_SHADOW_SALE_RECORDED",
      entityType: "pos_order",
      entityId: created.id,
      afterData: {
        folio: created.folio,
        total,
        serviceMode,
        paymentMethod,
        lineCount: lines.length,
        inventoryEffectApplied: false,
      },
    });

    return created;
  });

  redirect("/pos?saved=" + order.id);
}
