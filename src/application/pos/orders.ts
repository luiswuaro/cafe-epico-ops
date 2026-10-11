import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import {deriveCommandTimeline} from "@/src/domain/pos/command-timing";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
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
      mode: posOrders.mode,
      status: posOrders.status,
      serviceMode: posOrders.serviceMode,
      tableLabel: posOrders.tableLabel,
      total: posOrders.total,
      note: posOrders.note,
      createdAt: posOrders.createdAt,
      employeeName: employees.name,
      customerName: posCustomers.name,
      customerId: posOrders.customerId,
      loyaltyPointsPreview: posOrders.loyaltyPointsPreview,
    })
    .from(posOrders)
    .leftJoin(employees, eq(employees.id, posOrders.employeeId))
    .leftJoin(posCustomers, eq(posCustomers.id, posOrders.customerId))
    .where(
      and(
        eq(posOrders.organizationId, organizationId),
        eq(posOrders.storeId, storeId),
        or(inArray(posOrders.status, [...OPEN_STATUSES]),
          and(eq(posOrders.mode,"LIVE"),eq(posOrders.status,"PAID"),
            gte(posOrders.paidAt,new Date(Date.now()-12*60*60*1000))))!,
      ),
    )
    .orderBy(asc(posOrders.createdAt));

  if (rows.length === 0) return [];

  const lines = await db
    .select({
      id: posOrderLines.id,
      catalogId: posOrderLines.catalogExternalId,
      orderId: posOrderLines.orderId,
      name: posOrderLines.nameSnapshot,
      category: posOrderLines.categorySnapshot,
      unitPrice: posOrderLines.unitPrice,
      lineTotal: posOrderLines.lineTotal,
      quantity: posOrderLines.quantity,
      note: posOrderLines.note,
      createdAt:posOrderLines.createdAt,
      expectedConsumption:posOrderLines.expectedConsumption,
    })
    .from(posOrderLines)
    .where(inArray(posOrderLines.orderId, rows.map((row) => row.id)))
    .orderBy(asc(posOrderLines.createdAt));

  const events=await db.select({
    entityId:auditEvents.entityId,action:auditEvents.action,
    createdAt:auditEvents.createdAt,afterData:auditEvents.afterData,
  }).from(auditEvents).where(and(
    eq(auditEvents.organizationId,organizationId),
    eq(auditEvents.entityType,"pos_order"),
    inArray(auditEvents.entityId,rows.map(row=>row.id)),
    inArray(auditEvents.action,["POS_COMMAND_PRINT_ACKNOWLEDGED","POS_COMMAND_STATUS_CHANGED","POS_TAKEAWAY_DISPATCHED"]),
  ));
  return rows.map(row=>{
    const orderLines=lines.filter(line=>line.orderId===row.id);
    const timing=deriveCommandTimeline(row.createdAt,
      orderLines.map(line=>({createdAt:line.createdAt,expectedConsumption:line.expectedConsumption})),
      events.filter(event=>event.entityId===row.id));
    const hasTakeaway=orderLines.some(l=>l.expectedConsumption?.serviceMode==="TAKEAWAY");
    return {...row,...timing,hasTakeaway,
      lines:orderLines.map(line=>({
        ...line,isAdditionalRound:line.expectedConsumption?.additionalRound===true,
      })),
    };
  }).filter(row=>!(row.status==="PAID" &&
    (row.dispatchedAt!==null||
     !row.hasTakeaway)));
}
