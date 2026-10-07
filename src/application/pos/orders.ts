import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  employees,
  posCustomers,
  posOrderLines,
  posOrders,
} from "@/src/infrastructure/db/schema";

const OPEN_STATUSES = ["SENT", "PREPARING", "READY", "PARTIALLY_PAID"] as const;

export async function getOpenPosOrders(
  organizationId: string,
  storeId: string,
) {
  const db = getDb();

  const rows = await db
    .select({
      id: posOrders.id,
      folio: posOrders.folio,
      status: posOrders.status,
      serviceMode: posOrders.serviceMode,
      tableLabel: posOrders.tableLabel,
      total: posOrders.total,
      note: posOrders.note,
      createdAt: posOrders.createdAt,
      employeeName: employees.name,
      customerName: posCustomers.name,
      loyaltyPointsPreview: posOrders.loyaltyPointsPreview,
    })
    .from(posOrders)
    .leftJoin(employees, eq(employees.id, posOrders.employeeId))
    .leftJoin(posCustomers, eq(posCustomers.id, posOrders.customerId))
    .where(
      and(
        eq(posOrders.organizationId, organizationId),
        eq(posOrders.storeId, storeId),
        inArray(posOrders.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(asc(posOrders.createdAt));

  if (rows.length === 0) return [];

  const lines = await db
    .select({
      id: posOrderLines.id,
      orderId: posOrderLines.orderId,
      name: posOrderLines.nameSnapshot,
      quantity: posOrderLines.quantity,
    })
    .from(posOrderLines)
    .where(inArray(posOrderLines.orderId, rows.map((row) => row.id)))
    .orderBy(asc(posOrderLines.createdAt));

  return rows.map((row) => ({
    ...row,
    lines: lines.filter((line) => line.orderId === row.id),
  }));
}
