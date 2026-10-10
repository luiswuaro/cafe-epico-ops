import {planInventoryReversals} from "./reversal-plan";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents, inventoryBalances, inventoryMovements,
  posCashMovements, posCashSessions, posCustomers, posLoyaltyEntries,
  posOrderSplits, posOrders, posPayments,
} from "@/src/infrastructure/db/schema";

export async function cancelLiveOrder(input:{
  organizationId:string;storeId:string;orderId:string;
  employeeId:string;actorUserId:string;reason:string;
}){
  const db=getDb();
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.storeId}))`);
    const [order]=await tx.select().from(posOrders).where(and(
      eq(posOrders.id,input.orderId),
      eq(posOrders.organizationId,input.organizationId),
      eq(posOrders.storeId,input.storeId),
    )).limit(1);
    if(!order || order.mode!=="LIVE") throw new Error("Pedido LIVE inexistente.");
    if(order.status==="CANCELLED") return;
    if(!["PAID","PARTIALLY_PAID"].includes(order.status)) throw new Error("La orden no tiene pagos que revertir.");

    const [_splits,cashMovements,inventoryMovementsApplied,points,payments] = await Promise.all([
      tx.select().from(posOrderSplits).where(eq(posOrderSplits.orderId,order.id)),
      tx.select().from(posCashMovements).where(and(
        eq(posCashMovements.orderId,order.id),eq(posCashMovements.movementType,"SALE"),
      )),
      tx.select().from(inventoryMovements).where(and(
        eq(inventoryMovements.organizationId,input.organizationId),
        eq(inventoryMovements.storeId,input.storeId),
        eq(inventoryMovements.sourceType,"POS_LIVE_ORDER"),
        eq(inventoryMovements.sourceId,order.id),
      )),
      tx.select().from(posLoyaltyEntries).where(and(
        eq(posLoyaltyEntries.orderId,order.id),inArray(posLoyaltyEntries.entryType,["EARN","REDEEM"]),
      )),
      tx.select().from(posPayments).where(eq(posPayments.orderId,order.id)),
    ]);
    // Una comanda dividida se revierte completa: todos los movimientos de inventario,
    // efectivo y puntos vinculados al folio, nunca sólo el último cobro.
    if(payments.some(payment=>payment.method!=="CASH" && payment.method!=="POINTS")) {
      throw new Error("Los pagos por tarjeta o transferencia requieren confirmar el reembolso externo con administración.");
    }
    if(order.inventoryEffectApplied && inventoryMovementsApplied.length===0){
      throw new Error("Falta el movimiento de inventario; intervención administrativa requerida.");
    }
    if(order.loyaltyEffectApplied && order.customerId && points.length===0 && Number(order.loyaltyPointsPreview)>0) {
      throw new Error("Falta la acreditación original de puntos.");
    }
    for(const cash of cashMovements){
      const [session]=await tx.select().from(posCashSessions).where(and(
        eq(posCashSessions.id,cash.sessionId),eq(posCashSessions.status,"OPEN"),
      )).limit(1);
      if(!session) throw new Error("El efectivo pertenece a caja cerrada. Requiere devolución administrativa.");
    }
    const now=new Date();
    const updated=await tx.update(posOrders).set({
      status:"CANCELLED",cancelledAt:now,cancelledByEmployeeId:input.employeeId,
      cancelReason:input.reason,updatedAt:now,
      inventoryEffectApplied:false,loyaltyEffectApplied:false,
    }).where(and(eq(posOrders.id,order.id),eq(posOrders.status,order.status)))
      .returning({id:posOrders.id});
    if(!updated.length) throw new Error("La orden cambió de estado. Actualiza la pantalla.");

    // Las dos cuentas pueden tener el mismo insumo: la reversa se agrega por clave única.
    for(const movement of planInventoryReversals(inventoryMovementsApplied)){
      const returned=movement.returned;
      await tx.insert(inventoryMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        locationId:movement.locationId,inventoryItemId:movement.inventoryItemId,
        movementType:"MANUAL_ADJUSTMENT",quantityDelta:returned.toFixed(3),
        sourceType:"POS_LIVE_CANCEL",sourceId:order.id,
        occurredAt:now,employeeId:input.employeeId,
        note:"Reversa de venta "+order.folio+"; "+input.reason,
        externalProvider:"OPS_POS_CANCEL",externalId:order.id,
      });
      await tx.update(inventoryBalances).set({
        theoreticalQuantity:sql`${inventoryBalances.theoreticalQuantity} + ${returned}`,
        updatedAt:now,
      }).where(and(
        eq(inventoryBalances.storeId,input.storeId),
        eq(inventoryBalances.locationId,movement.locationId),
        eq(inventoryBalances.inventoryItemId,movement.inventoryItemId),
      ));
    }
    // Revertir por cliente en un solo saldo neto (EARN y REDEEM),
    // evitando saldos transitorios negativos y canjes duplicados.
    const reversalTotals=new Map<string,number>();
    for(const entry of points){
      const delta=-Number(entry.points);
      reversalTotals.set(entry.customerId,
        Math.round(((reversalTotals.get(entry.customerId)??0)+delta)*100)/100);
    }
    for(const [customerId,delta] of reversalTotals){
      const [updatedCustomer]=await tx.update(posCustomers).set({
        pointsBalance:sql`${posCustomers.pointsBalance} + ${delta}`,updatedAt:now,
      }).where(and(
        eq(posCustomers.id,customerId),
        eq(posCustomers.organizationId,input.organizationId),
        sql`${posCustomers.pointsBalance} + ${delta} >= 0`,
      )).returning({id:posCustomers.id});
      if(!updatedCustomer)throw new Error(
        "No se puede cancelar automáticamente: parte de los puntos ganados ya se utilizó. Requiere revisión administrativa."
      );
    }
    for(const entry of points){
      const refund=-Number(entry.points);
      await tx.insert(posLoyaltyEntries).values({
        organizationId:input.organizationId,customerId:entry.customerId,orderId:order.id,
        entryType:"REVERSAL",points:refund.toFixed(2),note:"Cancelación "+order.folio+" · "+entry.entryType,
      });
    }
    if(cashMovements.length){
      await tx.insert(posCashMovements).values(cashMovements.map(m=>({
        organizationId:input.organizationId,storeId:input.storeId,
        sessionId:m.sessionId,orderId:order.id,employeeId:input.employeeId,
        movementType:"REFUND",amount:(-Number(m.amount)).toFixed(2),
        note:"Cancelación "+order.folio,
      })));
    }
    await tx.insert(auditEvents).values({
      organizationId:input.organizationId,storeId:input.storeId,
      actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
      action:"POS_LIVE_CANCELLED_REVERSED",entityType:"pos_order",entityId:order.id,
      beforeData:{status:order.status,inventoryEffectApplied:order.inventoryEffectApplied,
        loyaltyEffectApplied:order.loyaltyEffectApplied},
      afterData:{status:"CANCELLED",reason:input.reason,
        inventoryMovementCount:inventoryMovementsApplied.length,pointsMovements:points.length,
        cashMovements:cashMovements.length,
        note:"La reversa es teórica; si la bebida se preparó, registrar merma física."},
    });
  });
}
