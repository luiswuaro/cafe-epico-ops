"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import {
  getOpenCashSession,
  isCashSessionCurrentBusinessDate,
} from "@/src/application/pos/cash";
import { resolveCashTender } from "@/src/application/pos/payment";
import { syncLoyverseReceipts } from "@/src/application/loyverse/sync";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCashMovements,
  posCashSessions,
  posCustomers,
  posOrderLines,
  posOrderSplits,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

const cartSchema = z
  .array(
    z.object({
      externalId: z.string().min(1),
      quantity: z.number().int().min(1).max(20),
      note: z.string().trim().max(180).nullable().optional(),
    }),
  )
  .min(1)
  .max(30);

const serviceModeSchema = z.enum(["DINE_IN", "TAKEAWAY"]);
const paymentSchema = z.enum(["CASH", "CARD", "TRANSFER"]);
const commandStatusSchema = z.enum(["SENT", "PREPARING", "READY"]);

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
  return "CE-" + stamp + "-" + clientOrderId.slice(-4).toUpperCase();
}

async function buildOrderInput(
  formData: FormData,
  organizationId: string,
) {
  const rawCart = String(formData.get("cart") ?? "[]");
  const serviceMode = serviceModeSchema.parse(
    String(formData.get("serviceMode") ?? ""),
  );
  const tableLabel = String(formData.get("tableLabel") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const customerId = String(formData.get("customerId") ?? "").trim() || null;

  const parsedCart = cartSchema.parse(JSON.parse(rawCart));
  const catalog = await getPosCatalog(organizationId);
  const catalogById = new Map(catalog.map((item) => [item.id, item]));

  const lines = parsedCart.map((line) => {
    const item = catalogById.get(line.externalId);
    if (!item) throw new Error("Producto no disponible en el catálogo POS");

    const lineTotal = item.price * line.quantity;
    const serviceRecipe =
      item.serviceRecipes[serviceMode as PosServiceMode];

    if (
      (item.category === "CALIENTES" || item.category === "FRÍAS") &&
      !serviceRecipe.configured
    ) {
      throw new Error(
        "La bebida " + item.name + " no tiene receta operativa completa",
      );
    }

    if (
      (item.category === "CALIENTES" || item.category === "FRÍAS") &&
      serviceRecipe.components.some(
        (component) => !component.inventoryResolved,
      )
    ) {
      throw new Error(
        "La bebida " +
          item.name +
          " tiene un componente de receta sin resolver. Corrige la receta antes de cobrarla.",
      );
    }

    if (
      (item.category === "CALIENTES" || item.category === "FRÍAS") &&
      serviceRecipe.components.some(
        (component) =>
          component.inventoryTracked && !component.variantExternalId,
      )
    ) {
      throw new Error(
        "La bebida " +
          item.name +
          " tiene un insumo controlado sin vínculo de inventario.",
      );
    }

    return {
      item,
      quantity: line.quantity,
      note: line.note?.trim() || null,
      lineTotal,
      expectedConsumption: {
        mode: "LIVE",
        serviceMode,
        sourceRecipeExternalId: serviceRecipe.externalId,
        sourceCategory: serviceRecipe.sourceCategory,
        components: serviceRecipe.components.map((component) => ({
          variantExternalId: component.variantExternalId,
          itemExternalId: component.itemExternalId,
          name: component.name,
          quantity: component.quantity * line.quantity,
          unitLabel: component.unitLabel,
          category: component.category,
          inventoryTracked: component.inventoryTracked,
          inventoryResolved: component.inventoryResolved,
        })),
      },
    };
  });

  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  if (customerId) {
    const [customer] = await getDb()
      .select({ id: posCustomers.id })
      .from(posCustomers)
      .where(
        and(
          eq(posCustomers.id, customerId),
          eq(posCustomers.organizationId, organizationId),
          eq(posCustomers.isActive, true),
        ),
      )
      .limit(1);

    if (!customer) throw new Error("Cliente no válido");
  }

  return {
    serviceMode,
    tableLabel,
    note,
    customerId,
    lines,
    total,
    loyaltyPointsPreview: customerId
      ? Math.round(total * 0.05 * 100) / 100
      : 0,
  };
}

async function createShadowOrder(
  formData: FormData,
  status: "PAID" | "SENT",
  paymentMethod?: "CASH" | "CARD" | "TRANSFER",
) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const input = await buildOrderInput(formData, employee.organizationId);
  const rawClientOrderId = String(formData.get("clientOrderId") ?? "").trim();
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

  if (existing) return existing.id;

  const cashSession =
    status === "PAID" && paymentMethod === "CASH"
      ? await getOpenCashSession(
          employee.organizationId,
          employee.homeStoreId,
        )
      : null;

  if (status === "PAID" && paymentMethod === "CASH" && !cashSession) {
    throw new Error("Abre la caja antes de cobrar en efectivo");
  }

  if (
    status === "PAID" &&
    paymentMethod === "CASH" &&
    cashSession &&
    !isCashSessionCurrentBusinessDate(cashSession.openedAt)
  ) {
    throw new Error(
      "La caja abierta corresponde a otro día. Ciérrala antes de cobrar en efectivo.",
    );
  }

  const tender =
    status === "PAID" && paymentMethod
      ? resolveCashTender(formData, input.total, paymentMethod)
      : {
          tenderedAmount: null,
          changeAmount: null,
          tendered: null,
          change: null,
        };

  const order = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(posOrders)
      .values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId!,
        clientOrderId,
        folio: folio(now, clientOrderId),
        mode: "LIVE",
        status,
        serviceMode: input.serviceMode,
        tableLabel:
          input.serviceMode === "DINE_IN" ? input.tableLabel : null,
        employeeId: employee.id,
        customerId: input.customerId,
        businessDate: businessDate(now),
        subtotal: input.total.toFixed(2),
        total: input.total.toFixed(2),
        note: input.note,
        loyaltyPointsPreview: input.loyaltyPointsPreview.toFixed(2),
        loyaltyEffectApplied: false,
        inventoryEffectApplied: false,
        paidAt: status === "PAID" ? now : null,
      })
      .returning();

    await tx.insert(posOrderLines).values(
      input.lines.map((line) => ({
        organizationId: employee.organizationId,
        orderId: created.id,
        catalogExternalId: line.item.id,
        variantExternalId: line.item.variantExternalId,
        nameSnapshot: line.item.name,
        categorySnapshot: line.item.category,
        unitPrice: line.item.price.toFixed(2),
        quantity: String(line.quantity),
        lineTotal: line.lineTotal.toFixed(2),
        note: line.note,
        expectedConsumption: line.expectedConsumption,
      })),
    );

    if (status === "PAID" && paymentMethod) {
      await tx.insert(posPayments).values({
        organizationId: employee.organizationId,
        orderId: created.id,
        method: paymentMethod,
        amount: input.total.toFixed(2),
        tenderedAmount: tender.tenderedAmount,
        changeAmount: tender.changeAmount,
      });

      if (paymentMethod === "CASH" && cashSession) {
        await tx.insert(posCashMovements).values({
          organizationId: employee.organizationId,
          storeId: employee.homeStoreId!,
          sessionId: cashSession.id,
          orderId: created.id,
          employeeId: employee.id,
          movementType: "SALE",
          amount: input.total.toFixed(2),
          note:
            tender.tenderedAmount && tender.changeAmount
              ? created.folio +
                " · Recibido $" +
                tender.tenderedAmount +
                " · Cambio $" +
                tender.changeAmount
              : created.folio,
        });
      }
    }

    if (status === "PAID") {
      await tx.execute(
        sql`select public.apply_pos_order_inventory(
          ${created.id}::uuid,
          ${employee.id}::uuid
        )`,
      );

      if (input.customerId) {
        await tx.execute(
          sql`select public.apply_pos_order_loyalty(
            ${created.id}::uuid
          )`,
        );
      }
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action:
        status === "PAID"
          ? "POS_LIVE_SALE_RECORDED"
          : "POS_LIVE_COMMAND_SENT",
      entityType: "pos_order",
      entityId: created.id,
      afterData: {
        folio: created.folio,
        total: input.total,
        serviceMode: input.serviceMode,
        customerId: input.customerId,
        loyaltyPointsPreview: input.loyaltyPointsPreview,
        status,
        cashTendered: tender.tendered,
        cashChange: tender.change,
        inventoryEffectApplied: status === "PAID",
        loyaltyEffectApplied: status === "PAID" && Boolean(input.customerId),
      },
    });

    return created;
  });

  return order.id;
}

export async function createShadowSale(formData: FormData) {
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const orderId = await createShadowOrder(
    formData,
    "PAID",
    paymentMethod,
  );
  redirect("/pos?saved=" + orderId);
}

export async function createShadowCommand(formData: FormData) {
  const orderId = await createShadowOrder(formData, "SENT");
  redirect("/pos/orders?created=" + orderId);
}

export async function updateCommandStatus(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const status = commandStatusSchema.parse(
    String(formData.get("status") ?? ""),
  );
  const db = getDb();

  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Comanda no encontrada");
  if (!["SENT", "PREPARING", "READY"].includes(order.status)) {
    throw new Error("La comanda ya no está abierta");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(posOrders)
      .set({ status, updatedAt: new Date() })
      .where(eq(posOrders.id, order.id));

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_COMMAND_STATUS_CHANGED",
      entityType: "pos_order",
      entityId: order.id,
      beforeData: { status: order.status },
      afterData: { status },
    });
  });

  revalidatePath("/pos/orders");
}

export async function payShadowCommand(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const db = getDb();

  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Comanda no encontrada");
  if (!["SENT", "PREPARING", "READY"].includes(order.status)) {
    redirect("/pos?saved=" + order.id);
  }

  const [existingSplit] = await db
    .select({ id: posOrderSplits.id })
    .from(posOrderSplits)
    .where(eq(posOrderSplits.orderId, order.id))
    .limit(1);

  if (existingSplit) {
    redirect("/pos/orders/" + order.id + "/split");
  }

  const cashSession =
    paymentMethod === "CASH"
      ? await getOpenCashSession(
          employee.organizationId,
          employee.homeStoreId,
        )
      : null;

  if (paymentMethod === "CASH" && !cashSession) {
    throw new Error("Abre la caja antes de cobrar en efectivo");
  }

  if (
    paymentMethod === "CASH" &&
    cashSession &&
    !isCashSessionCurrentBusinessDate(cashSession.openedAt)
  ) {
    throw new Error(
      "La caja abierta corresponde a otro día. Ciérrala antes de cobrar en efectivo.",
    );
  }

  const tender = resolveCashTender(formData, order.total, paymentMethod);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(posOrders)
      .set({
        status: "PAID",
        paidAt: now,
        updatedAt: now,
      })
      .where(eq(posOrders.id, order.id));

    await tx.insert(posPayments).values({
      organizationId: employee.organizationId,
      orderId: order.id,
      method: paymentMethod,
      amount: order.total,
      tenderedAmount: tender.tenderedAmount,
      changeAmount: tender.changeAmount,
    });

    if (paymentMethod === "CASH" && cashSession) {
      await tx.insert(posCashMovements).values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId!,
        sessionId: cashSession.id,
        orderId: order.id,
        employeeId: employee.id,
        movementType: "SALE",
        amount: order.total,
        note:
          tender.tenderedAmount && tender.changeAmount
            ? order.folio +
              " · Recibido $" +
              tender.tenderedAmount +
              " · Cambio $" +
              tender.changeAmount
            : order.folio,
      });
    }

    await tx.execute(
      sql`select public.apply_pos_order_inventory(
        ${order.id}::uuid,
        ${employee.id}::uuid
      )`,
    );

    if (order.customerId) {
      await tx.execute(
        sql`select public.apply_pos_order_loyalty(
          ${order.id}::uuid
        )`,
      );
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_LIVE_COMMAND_PAID",
      entityType: "pos_order",
      entityId: order.id,
      beforeData: { status: order.status },
      afterData: {
        status: "PAID",
        paymentMethod,
        cashTendered: tender.tendered,
        cashChange: tender.change,
        loyaltyPointsPreview: order.loyaltyPointsPreview,
        inventoryEffectApplied: true,
        loyaltyEffectApplied: Boolean(order.customerId),
      },
    });
  });

  redirect("/pos?saved=" + order.id);
}

export async function createPosCustomer(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;

  if (name.length < 2) throw new Error("Escribe el nombre del cliente");

  const db = getDb();
  const [customer] = await db
    .insert(posCustomers)
    .values({
      organizationId: employee.organizationId,
      name,
      phone,
      email,
      pointsBalance: "0",
    })
    .returning({ id: posCustomers.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "POS_CUSTOMER_CREATED",
    entityType: "pos_customer",
    entityId: customer.id,
    afterData: { name, phone, email, pointsBalance: 0 },
  });

  redirect("/pos?customer=" + customer.id);
}

export async function cancelPosOrder(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.cancel",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!orderId) throw new Error("Falta la orden a cancelar");
  if (reason.length < 3) throw new Error("Escribe el motivo de cancelación");

  const db = getDb();
  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, employee.organizationId),
        eq(posOrders.storeId, employee.homeStoreId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Orden no encontrada");
  if (order.status === "CANCELLED") {
    redirect("/pos?saved=" + order.id);
  }
  const [paidSplit] = await db
    .select({ id: posOrderSplits.id })
    .from(posOrderSplits)
    .where(
      and(
        eq(posOrderSplits.orderId, order.id),
        eq(posOrderSplits.status, "PAID"),
      ),
    )
    .limit(1);

  if (paidSplit) {
    throw new Error(
      "Esta orden tiene cuentas divididas ya pagadas. La reversa parcial requiere flujo administrativo.",
    );
  }

  const cashSales = await db
    .select()
    .from(posCashMovements)
    .where(
      and(
        eq(posCashMovements.orderId, order.id),
        eq(posCashMovements.movementType, "SALE"),
      ),
    );

  if (cashSales.length > 0) {
    const [cashSession] = await db
      .select()
      .from(posCashSessions)
      .where(eq(posCashSessions.id, cashSales[0].sessionId))
      .limit(1);

    if (!cashSession || cashSession.status !== "OPEN") {
      throw new Error(
        "Este cobro en efectivo pertenece a una caja ya cerrada. No se puede cancelar sin una reversa administrativa.",
      );
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(posOrders)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByEmployeeId: employee.id,
        cancelReason: reason,
        updatedAt: now,
      })
      .where(eq(posOrders.id, order.id));

    if (cashSales.length > 0) {
      await tx.insert(posCashMovements).values(
        cashSales.map((movement) => ({
          organizationId: employee.organizationId,
          storeId: employee.homeStoreId!,
          sessionId: movement.sessionId,
          orderId: order.id,
          employeeId: employee.id,
          movementType: "REFUND",
          amount: (-Number(movement.amount)).toFixed(2),
          note: "Cancelación · " + order.folio,
        })),
      );
    }

    if (order.inventoryEffectApplied) {
      await tx.execute(
        sql`select public.reverse_pos_order_inventory(
          ${order.id}::uuid,
          ${employee.id}::uuid
        )`,
      );
    }

    if (order.loyaltyEffectApplied) {
      await tx.execute(
        sql`select public.reverse_pos_order_loyalty(
          ${order.id}::uuid
        )`,
      );
    }

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_ORDER_CANCELLED",
      entityType: "pos_order",
      entityId: order.id,
      beforeData: { status: order.status },
      afterData: {
        status: "CANCELLED",
        reason,
        inventoryEffectApplied: false,
        loyaltyEffectApplied: false,
      },
    });
  });

  redirect("/pos?saved=" + order.id + "&cancelled=1");
}

export async function refreshShadowMirror(formData: FormData) {
  const { employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) {
    throw new Error("El empleado no tiene sucursal asignada");
  }

  await assertEmployeePermission(
    employee.id,
    "pos.mirror.read",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) throw new Error("Falta la orden a comparar");

  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await syncLoyverseReceipts(since);

  redirect("/pos?saved=" + orderId + "&synced=1");
}
