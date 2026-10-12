"use server";

import {and,eq,ne,sql} from "drizzle-orm";
import {redirect} from "next/navigation";
import {z} from "zod";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {DINE_IN_TICKET_PRESETS,validateTicketLabel} from "@/src/application/pos/ticket-names";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,posOrderLines,posOrderSplits,posOrders,posPayments} from "@/src/infrastructure/db/schema";

const OPEN=["SENT","PREPARING","READY"];
const uuid=z.string().uuid();
const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function failure(error:unknown):never{
  const message=error instanceof Error?error.message:"No se pudo editar el pedido";
  redirect("/pos/orders?error="+encodeURIComponent(message.slice(0,240)));
}
async function principal(){
  assertNoPreviewMutation();
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  return {user,employee,storeId:employee.homeStoreId};
}

/** Cambio de mesa: conserva el ID, las rondas, el consumo y los puntos. */
export async function moveLiveTable(form:FormData){
  const {user,employee,storeId}=await principal();
  const orderId=uuid.parse(form.get("orderId"));
  const destination=validateTicketLabel("DINE_IN",z.string().parse(form.get("tableLabel")))!;
  if(!(DINE_IN_TICKET_PRESETS as readonly string[]).includes(destination))
    throw new Error("Selecciona una mesa existente");
  try{
    await getDb().transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,storeId))).for("update").limit(1);
      if(!order||order.mode!=="LIVE"||order.serviceMode!=="DINE_IN"||!OPEN.includes(order.status))
        throw new Error("Sólo puedes mover una mesa abierta y sin pagos.");
      if(order.tableLabel===destination)return;
      const payments=await tx.select({id:posPayments.id}).from(posPayments)
        .where(eq(posPayments.orderId,order.id)).limit(1);
      if(payments.length)throw new Error("No puedes mover una cuenta con pagos.");
      const occupied=await tx.select({id:posOrders.id,folio:posOrders.folio}).from(posOrders)
        .where(and(eq(posOrders.organizationId,employee.organizationId),
          eq(posOrders.storeId,storeId),eq(posOrders.mode,"LIVE"),
          eq(posOrders.tableLabel,destination),ne(posOrders.id,orderId),
          sql`${posOrders.status} in ('SENT','PREPARING','READY','PARTIALLY_PAID')`)).limit(1);
      if(occupied.length)throw new Error(destination+" está ocupada por "+occupied[0].folio+". No se fusionaron cuentas.");
      await tx.update(posOrders).set({tableLabel:destination,updatedAt:new Date()})
        .where(eq(posOrders.id,order.id));
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId,actorUserId:user.id,
        actorEmployeeId:employee.id,entityType:"pos_order",entityId:order.id,
        action:"POS_LIVE_TABLE_MOVED",beforeData:{tableLabel:order.tableLabel},
        afterData:{tableLabel:destination,folio:order.folio},
      });
    });
  }catch(error){failure(error);}
  redirect("/pos/orders?moved="+orderId);
}

/** Corrige cantidades ANTES de cobrar; sólo administración puede anular productos.
 * No crea ingresos, consumos ni devoluciones: el stock LIVE se aplica al cobrar.
 * La huella de la rectificación queda en audit_events.
 */
export async function removeLiveOrderUnits(form:FormData){
  const {user,employee,storeId}=await principal();
  await assertEmployeePermission(employee.id,"pos.cancel",storeId);
  const orderId=uuid.parse(form.get("orderId"));
  const lineId=uuid.parse(form.get("lineId"));
  const removeUnits=z.coerce.number().int().min(1).max(99).parse(form.get("units"));
  const reason=z.string().trim().min(3).max(200).parse(form.get("reason"));
  try{
    await getDb().transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,storeId))).for("update").limit(1);
      if(!order||order.mode!=="LIVE"||!OPEN.includes(order.status))
        throw new Error("La comanda ya está pagada, dividida parcialmente o cerrada.");
      const [payments,splits]=await Promise.all([
        tx.select({id:posPayments.id}).from(posPayments).where(eq(posPayments.orderId,orderId)).limit(1),
        tx.select({id:posOrderSplits.id}).from(posOrderSplits).where(eq(posOrderSplits.orderId,orderId)).limit(1),
      ]);
      if(payments.length||splits.length)
        throw new Error("La cuenta ya tiene pagos o divisiones. Revisa primero la división.");
      const lines=await tx.select().from(posOrderLines).where(and(
        eq(posOrderLines.organizationId,employee.organizationId),eq(posOrderLines.orderId,orderId)));
      if(lines.length===1&&removeUnits>=Number(lines[0].quantity)&&lines[0].id===lineId)
        throw new Error("Es el último producto. Usa Cancelar comanda para cerrar el pedido.");
      const line=lines.find(row=>row.id===lineId);
      if(!line)throw new Error("Producto inexistente en esta comanda");
      const originalQty=Number(line.quantity);
      if(!Number.isInteger(originalQty)||removeUnits>originalQty)
        throw new Error("Cantidad a quitar no válida");
      const remaining=originalQty-removeUnits;
      const originalTotal=Number(line.lineTotal);
      const newLineTotal=remaining?round2(originalTotal*remaining/originalQty):0;
      const subtracted=round2(originalTotal-newLineTotal);
      if(remaining===0){
        await tx.delete(posOrderLines).where(eq(posOrderLines.id,line.id));
      }else{
        const snapshot={...line.expectedConsumption};
        if(Array.isArray(snapshot.components)){
          snapshot.components=snapshot.components.map(raw=>{
            if(!raw||typeof raw!=="object")return raw;
            const c={...raw} as Record<string,unknown>;
            if(typeof c.quantity==="number")c.quantity=c.quantity*remaining/originalQty;
            if(c.costOnlyMeasure&&typeof c.costOnlyMeasure==="object"){
              const m={...c.costOnlyMeasure} as Record<string,unknown>;
              if(typeof m.estimatedCostMxn==="number")
                m.estimatedCostMxn=round2(m.estimatedCostMxn*remaining/originalQty);
              c.costOnlyMeasure=m;
            }
            return c;
          });
        }
        if(snapshot.discount&&typeof snapshot.discount==="object"){
          const d={...snapshot.discount} as Record<string,unknown>;
          if(typeof d.total==="number")d.total=round2(d.total*remaining/originalQty);
          snapshot.discount=d;
        }
        await tx.update(posOrderLines).set({
          quantity:String(remaining),lineTotal:newLineTotal.toFixed(2),expectedConsumption:snapshot,
        }).where(eq(posOrderLines.id,line.id));
      }
      const total=round2(Number(order.total)-subtracted);
      if(total<0)throw new Error("Total inconsistente; requiere revisión");
      await tx.update(posOrders).set({
        total:total.toFixed(2),subtotal:total.toFixed(2),updatedAt:new Date(),
        loyaltyPointsPreview:(order.customerId?round2(total*.05):0).toFixed(2),
      }).where(eq(posOrders.id,orderId));
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId,actorUserId:user.id,
        actorEmployeeId:employee.id,action:"POS_LIVE_LINE_VOIDED",
        entityType:"pos_order",entityId:orderId,
        beforeData:{lineId,name:line.nameSnapshot,quantity:originalQty,total:Number(order.total)},
        afterData:{lineId,name:line.nameSnapshot,removed:removeUnits,remaining,
          amount:subtracted,total,reason,roundId:line.expectedConsumption?.roundId??"INITIAL"},
      });
    });
  }catch(error){failure(error);}
  redirect("/pos/orders?edited="+orderId);
}
