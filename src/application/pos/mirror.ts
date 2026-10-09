import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseReceipts,
  posOrderLines,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function receiptLines(payload: Record<string, unknown>) {
  const values = Array.isArray(payload.line_items) ? payload.line_items : [];
  return values.map((value) => {
    const row = asObject(value);
    return {
      name: typeof row.item_name === "string" ? row.item_name : "",
      quantity: Number(row.quantity ?? 0),
    };
  });
}

function fingerprint(lines: Array<{ name: string; quantity: number }>) {
  const grouped = new Map<string, number>();

  for (const line of lines) {
    const name = normalize(line.name);
    grouped.set(name, (grouped.get(name) ?? 0) + Number(line.quantity));
  }

  return [...grouped.entries()]
    .map(([name, quantity]) => name + ":" + quantity.toFixed(3))
    .sort()
    .join("|");
}

function receiptServiceMode(payload: Record<string, unknown>) {
  const value =
    typeof payload.dining_option === "string"
      ? normalize(payload.dining_option)
      : "";
  if (value.includes("LLEVAR")) return "TAKEAWAY";
  if (value.includes("DENTRO")) return "DINE_IN";
  return null;
}

function receiptPayment(payload: Record<string, unknown>) {
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const first = asObject(payments[0]);
  const type = typeof first.type === "string" ? normalize(first.type) : "";
  const name = typeof first.name === "string" ? normalize(first.name) : "";
  if (type === "CASH" || name.includes("EFECTIVO")) return "CASH";
  if (type === "CARD" || name.includes("TARJETA")) return "CARD";
  if (name.includes("TRANSFER")) return "TRANSFER";
  return type || null;
}

export async function getShadowOrderMirror(
  organizationId: string,
  orderId: string,
) {
  const db = getDb();
  const [order] = await db
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.id, orderId),
        eq(posOrders.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!order) return null;

  const [lines, payments] = await Promise.all([
    db
      .select()
      .from(posOrderLines)
      .where(eq(posOrderLines.orderId, order.id)),
    db
      .select()
      .from(posPayments)
      .where(eq(posPayments.orderId, order.id)),
  ]);

  // Las ventas LIVE son cobros originados en OPS; no tienen ni requieren
  // comprobante espejo de Loyverse. Evitar emparejamientos accidentales por total.
  if (order.mode === "LIVE") {
    return {
      order,
      lines,
      payment: payments[0] ?? null,
      mirror: null,
    };
  }

  const paidAt = order.paidAt ?? order.createdAt;
  const from = new Date(paidAt.getTime() - 60 * 60 * 1000);
  const to = new Date(paidAt.getTime() + 15 * 60 * 1000);

  const receipts = await db
    .select()
    .from(loyverseReceipts)
    .where(
      and(
        eq(loyverseReceipts.organizationId, organizationId),
        eq(loyverseReceipts.receiptType, "SALE"),
        gte(loyverseReceipts.receiptDate, from),
        lte(loyverseReceipts.receiptDate, to),
      ),
    )
    .orderBy(desc(loyverseReceipts.receiptDate))
    .limit(40);

  const orderFingerprint = fingerprint(
    lines.map((line) => ({
      name: line.nameSnapshot,
      quantity: Number(line.quantity),
    })),
  );
  const orderTotal = Number(order.total);
  const paymentMethod = payments[0]?.method ?? null;

  const candidates = receipts
    .filter((receipt) => {
      const payload = asObject(receipt.payload);
      return !payload.cancelled_at;
    })
    .map((receipt) => {
      const payload = asObject(receipt.payload);
      const total = Number(receipt.totalMoney ?? 0);
      const totalDiff = Math.abs(total - orderTotal);
      const linesExact =
        fingerprint(receiptLines(payload)) === orderFingerprint;
      const serviceMode = receiptServiceMode(payload);
      const payment = receiptPayment(payload);
      const timeDeltaSeconds = receipt.receiptDate
        ? Math.round((paidAt.getTime() - receipt.receiptDate.getTime()) / 1000)
        : null;

      return {
        externalId: receipt.externalId,
        receiptDate: receipt.receiptDate,
        total,
        totalDiff,
        linesExact,
        serviceMode,
        serviceModeExact:
          serviceMode == null || serviceMode === order.serviceMode,
        payment,
        paymentExact: payment == null || payment === paymentMethod,
        timeDeltaSeconds,
      };
    })
    .filter((candidate) => candidate.totalDiff <= 0.01)
    .sort((a, b) => {
      if (a.linesExact !== b.linesExact) return a.linesExact ? -1 : 1;
      if (a.serviceModeExact !== b.serviceModeExact)
        return a.serviceModeExact ? -1 : 1;
      if (a.paymentExact !== b.paymentExact)
        return a.paymentExact ? -1 : 1;
      return (
        Math.abs(a.timeDeltaSeconds ?? Number.MAX_SAFE_INTEGER) -
        Math.abs(b.timeDeltaSeconds ?? Number.MAX_SAFE_INTEGER)
      );
    });

  const best = candidates[0] ?? null;

  return {
    order,
    lines,
    payment: payments[0] ?? null,
    mirror: best
      ? {
          ...best,
          exact:
            best.totalDiff <= 0.01 &&
            best.linesExact &&
            best.serviceModeExact &&
            best.paymentExact,
        }
      : null,
  };
}

export async function getRecentShadowOrders(
  organizationId: string,
  storeId: string,
  limit = 6,
) {
  return getDb()
    .select()
    .from(posOrders)
    .where(
      and(
        eq(posOrders.organizationId, organizationId),
        eq(posOrders.storeId, storeId),
        eq(posOrders.mode, "SHADOW"),
        eq(posOrders.status, "PAID"),
      ),
    )
    .orderBy(desc(posOrders.paidAt))
    .limit(limit);
}
