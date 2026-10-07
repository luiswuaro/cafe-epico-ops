import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  posOrderLines,
  posOrderSplitLines,
  posOrderSplits,
  posOrders,
  posPayments,
} from "@/src/infrastructure/db/schema";

export async function getOrderSplitState(
  organizationId: string,
  storeId: string,
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
        eq(posOrders.storeId, storeId),
      ),
    )
    .limit(1);

  if (!order) return null;

  const [lines, splits] = await Promise.all([
    db
      .select()
      .from(posOrderLines)
      .where(eq(posOrderLines.orderId, orderId))
      .orderBy(asc(posOrderLines.createdAt)),
    db
      .select()
      .from(posOrderSplits)
      .where(eq(posOrderSplits.orderId, orderId))
      .orderBy(asc(posOrderSplits.createdAt)),
  ]);

  const splitIds = splits.map((split) => split.id);

  const [splitLines, payments] =
    splitIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select()
            .from(posOrderSplitLines)
            .where(inArray(posOrderSplitLines.splitId, splitIds)),
          db
            .select()
            .from(posPayments)
            .where(inArray(posPayments.splitId, splitIds)),
        ]);

  return {
    order,
    lines,
    splits: splits.map((split) => ({
      ...split,
      lines: splitLines.filter((line) => line.splitId === split.id),
      payment:
        payments.find((payment) => payment.splitId === split.id) ?? null,
    })),
  };
}
