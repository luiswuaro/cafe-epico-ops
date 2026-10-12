"use server";

import {and,desc,eq,gte,inArray,or,sql} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {auditEvents,employees,posOrderLines,posOrderSplits,posOrderSplitLines,
  posOrders,posPayments,posCustomers} from "@/src/infrastructure/db/schema";
import {kitchenOrderIdentity} from "@/src/application/pos/kitchen-slip";
import type {KitchenSlip} from "@/src/application/pos/kitchen-slip";
import type {DirectReceiptPayload} from "../receipt/[id]/direct-print-button";

export type HubJob={
 key:string;orderId:string;roundId?:string;kind:"KITCHEN"|"RECEIPT"|"PREBILL";
 createdAt:string;title:string;slip?:KitchenSlip;ticket?:DirectReceiptPayload;
};
type FeedInput={since:string};

async function principal(){
 const {user,employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sin sucursal operativa");
 await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
 return {user,employee,storeId:employee.homeStoreId};
}
function allowedSince(value:string){
 const date=new Date(value),now=Date.now();
 if(!Number.isFinite(date.getTime())||date.getTime()>now+60000||
   date.getTime()<now-3*86400000)throw new Error("Reinicia la estación de impresión: rango mayor a 72 horas.");
 return date;
}
/** La PC consulta órdenes nativas OPS, nunca el navegador del celular.
 * No activar históricos: los eventos deben ser posteriores al alta de estación.
 */
export async function getPrintStationJobs({since}:FeedInput):Promise<HubJob[]>{
 if(process.env.VERCEL_ENV==="preview")return [];
 const {employee,storeId}=await principal(),start=allowedSince(since),db=getDb();
 const orders=await db.select({order:posOrders,employeeName:employees.name,customerName:posCustomers.name})
   .from(posOrders).leftJoin(employees,eq(employees.id,posOrders.employeeId))
   .leftJoin(posCustomers,eq(posCustomers.id,posOrders.customerId))
   .where(and(eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,storeId),eq(posOrders.mode,"LIVE"),
      or(gte(posOrders.updatedAt,start),gte(posOrders.createdAt,start))))
   .orderBy(desc(posOrders.updatedAt)).limit(150);
 if(!orders.length)return [];
 const ids=orders.map(r=>r.order.id);
 const [lines,splits,splitLines,payments,audits]=await Promise.all([
  db.select().from(posOrderLines).where(inArray(posOrderLines.orderId,ids)),
  db.select().from(posOrderSplits).where(inArray(posOrderSplits.orderId,ids)),
  db.select({splitId:posOrderSplitLines.splitId,orderLineId:posOrderSplitLines.orderLineId,
    quantity:posOrderSplitLines.quantity,lineTotal:posOrderSplitLines.lineTotal})
    .from(posOrderSplitLines)
    .where(inArray(posOrderSplitLines.splitId,
      (await db.select({id:posOrderSplits.id}).from(posOrderSplits)
        .where(inArray(posOrderSplits.orderId,ids))).map(x=>x.id).concat(["00000000-0000-4000-8000-000000000000"]))),
  db.select().from(posPayments).where(inArray(posPayments.orderId,ids)),
  db.select({entityId:auditEvents.entityId,action:auditEvents.action,createdAt:auditEvents.createdAt,afterData:auditEvents.afterData})
    .from(auditEvents).where(and(eq(auditEvents.organizationId,employee.organizationId),
      eq(auditEvents.entityType,"pos_print_job"),
      gte(auditEvents.createdAt,start))),
 ]);
 const stopped=new Set(audits.filter(e=>
   e.action==="POS_PRINT_HUB_DONE"||e.action==="POS_PRINT_HUB_FAILED")
    .map(e=>e.entityId));
 const jobs:HubJob[]=[];
 const money=(value:number)=>new Intl.NumberFormat("es-MX",{
  style:"currency",currency:"MXN"}).format(value);
 for(const entry of orders){
  const order=entry.order;
  if(order.status==="CANCELLED")continue;
  const linesFor=lines.filter(x=>x.orderId===order.id);
  const byRound=new Map<string,typeof lines>();
  for(const line of linesFor){
    if(line.createdAt<start)continue;
    const round=typeof line.expectedConsumption?.roundId==="string"
       ?line.expectedConsumption.roundId:"INITIAL";
    const list=byRound.get(round)??[];list.push(line);byRound.set(round,list);
  }
  for(const [round,roundLines] of byRound){
    const key="KITCHEN:"+order.id+":"+round;
    if(stopped.has(key))continue;
    const slip:KitchenSlip={
      folio:order.folio,
      ...kitchenOrderIdentity({ticketLabel:order.tableLabel,
        customerName:entry.customerName,folio:order.folio}),
      orderNote:order.note,
      lines:roundLines.map(line=>({
        id:line.id,name:line.nameSnapshot,category:line.categorySnapshot,
        quantity:Number(line.quantity),note:line.note,
        serviceMode:line.expectedConsumption?.serviceMode==="TAKEAWAY"?"TAKEAWAY":"DINE_IN",
        roundId:round,
      })),
    };
    jobs.push({key,orderId:order.id,roundId:round,
      kind:"KITCHEN",createdAt:roundLines[0].createdAt.toISOString(),
      title:"Comanda "+(order.tableLabel??order.folio),slip});
  }
  const receiptLines=(selected:typeof lines)=>
    selected.map(line=>({quantity:Number(line.quantity),name:line.nameSnapshot,
      note:line.note,total:money(Number(line.lineTotal))}));
  const base={folio:order.folio,kind:"RECEIPT" as const,
    status:order.status,date:(order.paidAt??order.createdAt)
      .toLocaleString("es-MX",{timeZone:"America/Mexico_City"}),
    employee:entry.employeeName??"Equipo",service:order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí",
    customer:entry.customerName??null,pointsEarned:null,pointsBalance:null};
  const orderSplits=splits.filter(x=>x.orderId===order.id);
  if(orderSplits.length){
    for(const split of orderSplits){
      if(split.status!=="PAID"||!split.paidAt||split.paidAt<start)continue;
      const key="RECEIPT:"+order.id+":"+split.id;
      if(stopped.has(key))continue;
      const selected=splitLines.filter(x=>x.splitId===split.id);
      const parts=selected.flatMap(line=>{
        const original=linesFor.find(x=>x.id===line.orderLineId);
        return original?[{...original,quantity:line.quantity,lineTotal:line.lineTotal}]:[];
      });
      const methods=payments.filter(p=>p.splitId===split.id);
      jobs.push({key,orderId:order.id,kind:"RECEIPT",createdAt:split.paidAt.toISOString(),
        title:"Ticket "+split.label+" · "+order.folio,ticket:{
          ...base,splitLabel:split.label,items:receiptLines(parts),
          total:money(Number(split.total)),
          payment:methods.map(p=>p.method).join(" + ")||"PAGADO",
          cashTendered:methods.find(p=>p.method==="CASH")?.tenderedAmount??null,
          cashChange:methods.find(p=>p.method==="CASH")?.changeAmount??null,
        }});
    }
  }else if(order.status==="PAID"&&order.paidAt&&order.paidAt>=start){
    const key="RECEIPT:"+order.id;
    if(stopped.has(key))continue;
    const methods=payments.filter(p=>p.orderId===order.id);
    jobs.push({key,orderId:order.id,kind:"RECEIPT",
      createdAt:order.paidAt.toISOString(),title:"Ticket "+order.folio,
      ticket:{...base,items:receiptLines(linesFor),total:money(Number(order.total)),
        payment:methods.map(p=>p.method).join(" + ")||"Sin cobro · consumo interno",
        cashTendered:methods.find(p=>p.method==="CASH")?.tenderedAmount??null,
        cashChange:methods.find(p=>p.method==="CASH")?.changeAmount??null}});
  }
 }
 for(const event of audits){
  if(event.action!=="POS_PREBILL_PRINT_REQUESTED"||stopped.has(event.entityId))continue;
  const match=/^PREBILL:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(event.entityId);
  if(!match)continue;
  const current=orders.find(x=>x.order.id===match[1])?.order;
  if(!current||!["SENT","PREPARING","READY","PARTIALLY_PAID"].includes(current.status))continue;
  const payload=event.afterData?.ticket;
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||
     payload.kind!=="PREBILL"||!Array.isArray(payload.items))continue;
  jobs.push({key:event.entityId,orderId:match[1],kind:"PREBILL",
    createdAt:event.createdAt.toISOString(),
    title:"Precuenta "+(current.tableLabel??current.folio),
    ticket:payload as DirectReceiptPayload});
 }
 jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||
   (a.kind==="KITCHEN"?-1:1));
 return jobs.slice(0,30);
}
async function verifyJob(jobKey:string,org:string,store:string,tx:Pick<ReturnType<typeof getDb>,"select">){
 const match=/^(KITCHEN|RECEIPT|PREBILL):([0-9a-f-]{36})(?::([A-Za-z0-9_-]{1,120}))?$/i.exec(jobKey);
 if(!match)throw new Error("Trabajo de impresión inválido.");
 const [order]=await tx.select({id:posOrders.id}).from(posOrders).where(and(
  eq(posOrders.id,match[2]),eq(posOrders.organizationId,org),
  eq(posOrders.storeId,store),eq(posOrders.mode,"LIVE"))).limit(1);
 if(!order)throw new Error("Pedido de otra sucursal.");
 return order;
}
/** Claim atómico: nunca dos estaciones imprimen el mismo trabajo simultáneamente. */
export async function claimPrintStationJob(jobKey:string,stationId:string){
 assertNoPreviewMutation();
 const {employee,storeId,user}=await principal();
 if(!/^[0-9a-f-]{36}$/i.test(stationId))throw new Error("Estación inválida.");
 return getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
  await verifyJob(jobKey,employee.organizationId,storeId,tx);
  const events=await tx.select({action:auditEvents.action,createdAt:auditEvents.createdAt,
    afterData:auditEvents.afterData}).from(auditEvents).where(and(
    eq(auditEvents.organizationId,employee.organizationId),
    eq(auditEvents.entityType,"pos_print_job"),eq(auditEvents.entityId,jobKey)))
    .orderBy(desc(auditEvents.createdAt)).limit(8);
  if(events.some(e=>e.action==="POS_PRINT_HUB_DONE"||
      e.action==="POS_PRINT_HUB_FAILED"))return false;
  // Seguridad primero: si una estación reclamó un trabajo y se desconectó,
  // NO enviarlo otra vez automáticamente. Puede haber impreso papel antes de
  // perder el ACK. Exige conciliación y reimpresión manual supervisada.
  if(events.some(e=>e.action==="POS_PRINT_HUB_CLAIMED"))return false;
  await tx.insert(auditEvents).values({
    organizationId:employee.organizationId,storeId,
    actorUserId:user.id,actorEmployeeId:employee.id,
    action:"POS_PRINT_HUB_CLAIMED",entityType:"pos_print_job",entityId:jobKey,
    afterData:{stationId,leaseSeconds:120},
  });
  return true;
 });
}
export async function finishPrintStationJob(jobKey:string,stationId:string,
 outcome:"DONE"|"FAILED",details:string){
 assertNoPreviewMutation();
 const {employee,user,storeId}=await principal();
 if(!/^[0-9a-f-]{36}$/i.test(stationId))throw new Error("Estación inválida.");
 const action=outcome==="DONE"?"POS_PRINT_HUB_DONE":"POS_PRINT_HUB_FAILED";
 await getDb().transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
  await verifyJob(jobKey,employee.organizationId,storeId,tx);
  const previous=await tx.select({action:auditEvents.action,afterData:auditEvents.afterData})
    .from(auditEvents).where(and(eq(auditEvents.organizationId,employee.organizationId),
      eq(auditEvents.entityType,"pos_print_job"),eq(auditEvents.entityId,jobKey)))
    .orderBy(desc(auditEvents.createdAt)).limit(10);
  if(previous.some(x=>x.action==="POS_PRINT_HUB_DONE"))return;
  if(!previous.some(x=>x.action==="POS_PRINT_HUB_CLAIMED"&&
      x.afterData?.stationId===stationId))throw new Error("Este trabajo no pertenece a la estación.");
  await tx.insert(auditEvents).values({
    organizationId:employee.organizationId,storeId,
    actorUserId:user.id,actorEmployeeId:employee.id,
    action,entityType:"pos_print_job",entityId:jobKey,
    afterData:{stationId,details:details.slice(0,240)},
  });
 });
}

/** Una impresión manual sólo reenvía papel por decisión explícita del operador. */
export async function recordAuthorizedPrintReprint(jobKey:string){
 assertNoPreviewMutation();
 const {employee,storeId,user}=await principal();
 const db=getDb();
 await db.transaction(async tx=>{
  await verifyJob(jobKey,employee.organizationId,storeId,tx);
  await tx.insert(auditEvents).values({
   organizationId:employee.organizationId,storeId,
   actorUserId:user.id,actorEmployeeId:employee.id,
   action:"POS_PRINT_MANUAL_REPRINT_REQUESTED",
   entityType:"pos_print_job",entityId:jobKey,
   afterData:{reason:"OPERATOR_CONFIRMED_EXTRA_COPY"},
  });
 });
}
/** Estado común para UI de reimpresión y puente automático. */
export async function getPrintStationJobStatus(jobKey:string):
 Promise<"UNCLAIMED"|"CLAIMED"|"DONE"|"FAILED">{
 const {employee,storeId}=await principal();
 const db=getDb();
 await verifyJob(jobKey,employee.organizationId,storeId,db);
 const events=await db.select({action:auditEvents.action}).from(auditEvents)
  .where(and(eq(auditEvents.organizationId,employee.organizationId),
    eq(auditEvents.entityType,"pos_print_job"),eq(auditEvents.entityId,jobKey)))
  .orderBy(desc(auditEvents.createdAt)).limit(15);
 if(events.some(row=>row.action==="POS_PRINT_HUB_DONE"))return "DONE";
 if(events.some(row=>row.action==="POS_PRINT_HUB_FAILED"))return "FAILED";
 if(events.some(row=>row.action==="POS_PRINT_HUB_CLAIMED"))return "CLAIMED";
 return "UNCLAIMED";
}

/** Consultar configuración solo tras activar esta PC. */
export async function getPrintStationTemplate(){
 const {employee}=await principal();
 const {getPosPrintSettings}=await import("@/src/application/pos/print-settings");
 return getPosPrintSettings(employee.organizationId);
}
