import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  loyverseCustomers,
  loyverseReceiptLines,
  loyverseReceipts,
} from "@/src/infrastructure/db/schema";

function rec(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentLabel(payload: Record<string, unknown>) {
  const rows = Array.isArray(payload.payments) ? payload.payments : [];
  const labels = rows.flatMap((value) => {
    const payment = rec(value);
    const name =
      typeof payment.name === "string" ? payment.name.trim() : "";
    const type =
      typeof payment.type === "string" ? payment.type.trim() : "";
    const amount = num(payment.money_amount);
    if (!name && !type) return [];
    return [{
      name: name || type,
      amount,
    }];
  });

  return labels;
}

export async function getLoyverseReceiptsView(
  organizationId: string,
  days = 30,
  limit = 120,
) {
  const db = getDb();
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);

  const receipts = await db
    .select({
      externalId: loyverseReceipts.externalId,
      receiptType: loyverseReceipts.receiptType,
      receiptDate: loyverseReceipts.receiptDate,
      totalMoney: loyverseReceipts.totalMoney,
      payload: loyverseReceipts.payload,
      syncedAt: loyverseReceipts.syncedAt,
    })
    .from(loyverseReceipts)
    .where(
      and(
        eq(loyverseReceipts.organizationId, organizationId),
        gte(loyverseReceipts.receiptDate, since),
      ),
    )
    .orderBy(desc(loyverseReceipts.receiptDate))
    .limit(Math.max(1, Math.min(300, limit)));

  if (receipts.length === 0) {
    return {
      rows: [],
      lastSyncedAt: null as Date | null,
    };
  }

  const receiptIds = receipts.map((receipt) => receipt.externalId);
  const lines = await db
    .select({
      receiptExternalId: loyverseReceiptLines.receiptExternalId,
      quantity: loyverseReceiptLines.quantity,
      grossTotalMoney: loyverseReceiptLines.grossTotalMoney,
      payload: loyverseReceiptLines.payload,
    })
    .from(loyverseReceiptLines)
    .where(
      and(
        eq(loyverseReceiptLines.organizationId, organizationId),
        inArray(loyverseReceiptLines.receiptExternalId, receiptIds),
      ),
    );

  const customerIds = [
    ...new Set(
      receipts.flatMap((receipt) => {
        const id = receipt.payload.customer_id;
        return typeof id === "string" && id ? [id] : [];
      }),
    ),
  ];

  const customers =
    customerIds.length > 0
      ? await db
          .select({
            externalId: loyverseCustomers.externalId,
            name: loyverseCustomers.name,
          })
          .from(loyverseCustomers)
          .where(
            and(
              eq(loyverseCustomers.organizationId, organizationId),
              inArray(loyverseCustomers.externalId, customerIds),
            ),
          )
      : [];

  const customerById = new Map(
    customers.map((customer) => [customer.externalId, customer.name]),
  );
  const linesByReceipt = new Map<
    string,
    Array<{
      name: string;
      quantity: number;
      total: number;
    }>
  >();

  for (const line of lines) {
    const payload = rec(line.payload);
    const list = linesByReceipt.get(line.receiptExternalId) ?? [];
    list.push({
      name:
        typeof payload.item_name === "string"
          ? payload.item_name
          : "Producto",
      quantity: num(line.quantity),
      total: num(payload.total_money ?? line.grossTotalMoney),
    });
    linesByReceipt.set(line.receiptExternalId, list);
  }

  const rows = receipts.map((receipt) => {
    const payload = rec(receipt.payload);
    const customerId =
      typeof payload.customer_id === "string" ? payload.customer_id : null;
    const cancelledAt =
      typeof payload.cancelled_at === "string" && payload.cancelled_at
        ? new Date(payload.cancelled_at)
        : null;

    return {
      externalId: receipt.externalId,
      receiptType: receipt.receiptType ?? "—",
      receiptDate: receipt.receiptDate,
      total: num(receipt.totalMoney),
      gross:
        num(receipt.totalMoney) + num(payload.total_discount),
      discount: num(payload.total_discount),
      cancelledAt,
      status: cancelledAt
        ? ("CANCELLED" as const)
        : receipt.receiptType === "REFUND"
          ? ("REFUND" as const)
          : ("VALID" as const),
      diningOption:
        typeof payload.dining_option === "string"
          ? payload.dining_option
          : null,
      employeeName:
        typeof payload.employee_name === "string"
          ? payload.employee_name
          : null,
      customerName:
        customerId ? customerById.get(customerId) ?? null : null,
      payments: paymentLabel(payload),
      lines: linesByReceipt.get(receipt.externalId) ?? [],
      syncedAt: receipt.syncedAt,
    };
  });

  return {
    rows,
    lastSyncedAt: rows.reduce<Date | null>(
      (latest, row) =>
        !latest || row.syncedAt > latest ? row.syncedAt : latest,
      null,
    ),
  };
}
