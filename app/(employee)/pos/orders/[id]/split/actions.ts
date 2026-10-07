"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOpenCashSession } from "@/src/application/pos/cash";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  posCashMovements,
  posOrderLines,
  posOrderSplitLines,
  posOrderSplits,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

const allocationSchema = z.array(
  z.object({
    account: z.number().int().min(1).max(8),
    lineId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
  }),
);

const paymentSchema = z.enum(["CASH", "CARD", "TRANSFER"]);

export async function saveOrderSplit(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const orderId = String(formData.get("orderId") ?? "").trim();
  const accountCount = z.coerce.number().int().min(2).max(8).parse(
    formData.get("accountCount"),
  );
  const allocations = allocationSchema.parse(
    JSON.parse(String(formData.get("allocations") ?? "[]")),
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

  if (!order) throw new Error("Orden no encontrada");
  if (!["SENT", "PREPARING", "READY"].includes(order.status)) {
    throw new Error(
      "Sólo puedes dividir una comanda abierta sin pagos parciales",
    );
  }

  const [lines, existingSplits] = await Promise.all([
    db
      .select()
      .from(posOrderLines)
      .where(eq(posOrderLines.orderId, order.id)),
    db
      .select()
      .from(posOrderSplits)
      .where(eq(posOrderSplits.orderId, order.id)),
  ]);

  if (existingSplits.some((split) => split.status === "PAID")) {
    throw new Error("La división ya tiene pagos registrados");
  }

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const assignedByLine = new Map<string, number>();

  for (const allocation of allocations) {
    if (allocation.account > accountCount) {
      throw new Error("Asignación de cuenta inválida");
    }
    if (!lineById.has(allocation.lineId)) {
      throw new Error("Hay un producto que no pertenece a esta orden");
    }

    assignedByLine.set(
      allocation.lineId,
      (assignedByLine.get(allocation.lineId) ?? 0) + allocation.quantity,
    );
  }

  for (const line of lines) {
    if ((assignedByLine.get(line.id) ?? 0) !== Number(line.quantity)) {
      throw new Error(
        "Debes asignar todas las unidades de " + line.nameSnapshot,
      );
    }
  }

  for (let account = 1; account <= accountCount; account += 1) {
    if (!allocations.some((allocation) => allocation.account === account)) {
      throw new Error("La Cuenta " + account + " quedó vacía");
    }
  }

  await db.transaction(async (tx) => {
    if (existingSplits.length > 0) {
      await tx
        .delete(posOrderSplits)
        .where(
          inArray(
            posOrderSplits.id,
            existingSplits.map((split) => split.id),
          ),
        );
    }

    const splitValues = Array.from({ length: accountCount }, (_, index) => {
      const account = index + 1;
      const total = allocations
        .filter((allocation) => allocation.account === account)
        .reduce((sum, allocation) => {
          const line = lineById.get(allocation.lineId)!;
          return sum + Number(line.unitPrice) * allocation.quantity;
        }, 0);

      return {
        organizationId: employee.organizationId,
        orderId: order.id,
        label: "Cuenta " + account,
        total: total.toFixed(2),
      };
    });

    const createdSplits = await tx
      .insert(posOrderSplits)
      .values(splitValues)
      .returning();

    const splitByAccount = new Map(
      createdSplits.map((split, index) => [index + 1, split]),
    );

    await tx.insert(posOrderSplitLines).values(
      allocations.map((allocation) => {
        const line = lineById.get(allocation.lineId)!;
        return {
          organizationId: employee.organizationId,
          splitId: splitByAccount.get(allocation.account)!.id,
          orderLineId: line.id,
          quantity: String(allocation.quantity),
          lineTotal: (
            Number(line.unitPrice) * allocation.quantity
          ).toFixed(2),
        };
      }),
    );

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_ORDER_SPLIT_SAVED",
      entityType: "pos_order",
      entityId: order.id,
      afterData: {
        accountCount,
        totals: splitValues.map((split) => Number(split.total)),
      },
    });
  });

  redirect("/pos/orders/" + order.id + "/split?saved=1");
}

export async function payOrderSplit(formData: FormData) {
  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) throw new Error("Sin sucursal asignada");

  await assertEmployeePermission(
    employee.id,
    "pos.sell",
    employee.homeStoreId,
  );

  const splitId = String(formData.get("splitId") ?? "").trim();
  const paymentMethod = paymentSchema.parse(
    String(formData.get("paymentMethod") ?? ""),
  );
  const db = getDb();

  const [split] = await db
    .select()
    .from(posOrderSplits)
    .where(
      and(
        eq(posOrderSplits.id, splitId),
        eq(posOrderSplits.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!split) throw new Error("Cuenta dividida no encontrada");
  if (split.status === "PAID") {
    redirect("/pos/receipt/" + split.orderId + "?split=" + split.id);
  }

  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, split.orderId),
        eq(posOrders.storeId, employee.homeStoreId),
        eq(posOrders.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!order) throw new Error("Orden no encontrada");

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

  const now = new Date();

  await db.transaction(async (tx) => {
    const updatedSplit = await tx
      .update(posOrderSplits)
      .set({
        status: "PAID",
        paidAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(posOrderSplits.id, split.id),
          eq(posOrderSplits.status, "OPEN"),
        ),
      )
      .returning({ id: posOrderSplits.id });

    if (updatedSplit.length === 0) {
      throw new Error("Esta cuenta ya fue cobrada por otro dispositivo");
    }

    await tx.insert(posPayments).values({
      organizationId: employee.organizationId,
      orderId: order.id,
      splitId: split.id,
      method: paymentMethod,
      amount: split.total,
    });

    if (paymentMethod === "CASH" && cashSession) {
      await tx.insert(posCashMovements).values({
        organizationId: employee.organizationId,
        storeId: employee.homeStoreId,
        sessionId: cashSession.id,
        orderId: order.id,
        splitId: split.id,
        employeeId: employee.id,
        movementType: "SALE",
        amount: split.total,
        note: split.label + " · " + order.folio,
      });
    }

    const remaining = await tx
      .select({ id: posOrderSplits.id })
      .from(posOrderSplits)
      .where(
        and(
          eq(posOrderSplits.orderId, order.id),
          ne(posOrderSplits.status, "PAID"),
          ne(posOrderSplits.id, split.id),
        ),
      )
      .limit(1);

    await tx
      .update(posOrders)
      .set({
        status: remaining.length === 0 ? "PAID" : "PARTIALLY_PAID",
        paidAt: remaining.length === 0 ? now : null,
        updatedAt: now,
      })
      .where(eq(posOrders.id, order.id));

    await tx.insert(auditEvents).values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      actorUserId: user.id,
      actorEmployeeId: employee.id,
      action: "POS_ORDER_SPLIT_PAID",
      entityType: "pos_order_split",
      entityId: split.id,
      afterData: {
        label: split.label,
        total: Number(split.total),
        paymentMethod,
        orderId: order.id,
      },
    });
  });

  redirect("/pos/receipt/" + order.id + "?split=" + split.id);
}
