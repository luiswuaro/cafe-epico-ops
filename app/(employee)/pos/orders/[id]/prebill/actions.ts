"use server";

import {randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {redirect} from "next/navigation";
import {z} from "zod";
import {getOrderSplitState} from "@/src/application/pos/splits";
import {extraLabels} from "@/src/application/pos/extras";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,posOrders,posPayments} from "@/src/infrastructure/db/schema";
import type {DirectReceiptPayload} from "../../../receipt/[id]/direct-print-button";

const mxn=new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"});
export async function queuePrebillPrint(form:FormData){
 assertNoPreviewMutation();
 const {user,employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sucursal no configurada");
 await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
 const orderId=z.string().uuid().parse(form.get("orderId"));
 const splitId=z.union([z.string().uuid(),z.literal("")]).parse(form.get("splitId")??"");
 const requestId=z.string().uuid().parse(form.get("requestId")??randomUUID());
 const db=getDb(),state=await getOrderSplitState(employee.organizationId,employee.homeStoreId,orderId);
 if(!state||state.order.mode!=="LIVE"||!["SENT","PREPARING","READY","PARTIALLY_PAID"].includes(state.order.status))
   throw new Error("No se puede imprimir precuenta de una comanda cerrada.");
 const split=splitId?state.splits.find(row=>row.id===splitId):null;
 if(splitId&&!split)throw new Error("Cuenta dividida inexistente");
 if(split?.status==="PAID")throw new Error("La cuenta ya está pagada");
 const selected=split?split.lines.flatMap(a=>{
   const line=state.lines.find(x=>x.id===a.orderLineId);
   return line?[{...line,quantity:a.quantity,lineTotal:a.lineTotal}]:[];
 }):state.lines;
 const amount=Number(split?split.total:state.order.total);
 const payments=split?[]:await db.select({amount:posPayments.amount}).from(posPayments)
   .where(and(eq(posPayments.organizationId,employee.organizationId),eq(posPayments.orderId,orderId)));
 const paid=Math.min(amount,payments.reduce((sum,p)=>sum+Number(p.amount),0));
 const ticket:DirectReceiptPayload={
   kind:"PREBILL",folio:state.order.folio,status:state.order.status,
   date:new Date().toLocaleString("es-MX",{timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short"}),
   employee:"Equipo",service:state.order.tableLabel||
      (state.order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí"),
   splitLabel:split?.label??null,
   items:selected.map(line=>({
      quantity:Number(line.quantity),name:line.nameSnapshot,
      note:(line.expectedConsumption?.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí")+
        (line.note?" · "+line.note:""),
      extra:extraLabels(line.expectedConsumption,{showPrices:true}).join(" · ")||null,
      total:mxn.format(Number(line.lineTotal)),
   })),
   total:mxn.format(amount),paidAmount:paid>0?mxn.format(paid):undefined,
   outstanding:mxn.format(Math.max(0,amount-paid)),payment:"",
 };
 const key="PREBILL:"+orderId+":"+requestId;
 await db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
   const [current]=await tx.select().from(posOrders).where(and(
     eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
     eq(posOrders.storeId,employee.homeStoreId!))).for("update").limit(1);
   if(!current||!["SENT","PREPARING","READY","PARTIALLY_PAID"].includes(current.status)||
      current.updatedAt.getTime()!==state.order.updatedAt.getTime())
      throw new Error("La cuenta cambió mientras preparabas la precuenta. Actualiza e intenta de nuevo.");
   const [previous]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(
     eq(auditEvents.organizationId,employee.organizationId),
     eq(auditEvents.entityType,"pos_print_job"),eq(auditEvents.entityId,key),
     eq(auditEvents.action,"POS_PREBILL_PRINT_REQUESTED"))).limit(1);
   if(previous)return; // doble clic o reenvío de formulario: una sola copia
   await tx.insert(auditEvents).values({
     organizationId:employee.organizationId,storeId:employee.homeStoreId!,
     actorUserId:user.id,actorEmployeeId:employee.id,
     action:"POS_PREBILL_PRINT_REQUESTED",entityType:"pos_print_job",
     entityId:key,afterData:{ticket,orderId,splitId:splitId||null},
   });
   // Una comanda antigua debe ser visible en el feed de esta estación recién activada.
   await tx.update(posOrders).set({updatedAt:new Date()}).where(eq(posOrders.id,orderId));
 });
 redirect("/pos/orders/"+orderId+"/prebill"+(splitId?"?split="+splitId+"&queued=1":"?queued=1"));
}
