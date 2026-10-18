"use server";

import {and,desc,eq,gte,inArray,isNull,like,or,sql} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {getVerifiedHotPathUserId} from "@/src/infrastructure/auth/verified-hot-path-user";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {auditEvents,employees,posOrderLines,posOrderSplits,posOrderSplitLines,
  posOrders,posPayments,posCustomers,posLoyaltyEntries,posPrintStationStatus} from "@/src/infrastructure/db/schema";
import {extraLabels} from "@/src/application/pos/extras";
import {receiptLoyaltyView} from "@/src/domain/pos/receipt-loyalty";
import {efficientPrintFeedSince} from "@/src/domain/pos/print-feed-window";
import {QA_POS_PILOT_PREFIX,qaPosPrintPilotEnabled} from "@/src/domain/pos/qa-pos-print-pilot";
import {kitchenOrderIdentity} from "@/src/application/pos/kitchen-slip";
import type {KitchenSlip} from "@/src/application/pos/kitchen-slip";
import type {DirectReceiptPayload} from "../receipt/[id]/direct-print-button";

export type HubJob={
 key:string;orderId:string;roundId?:string;kind:"KITCHEN"|"RECEIPT"|"PREBILL"|"VOID";
 createdAt:string;title:string;slip?:KitchenSlip;ticket?:DirectReceiptPayload;
};
type FeedInput={since:string;lastVersion?:string};
export type HubFeed={jobs:HubJob[];version:string};
const MAX_AUTO_PRINT_AGE_MS=5*60*1000;
const HEARTBEAT_TIMEOUT_MS=60*1000;
// Fixture de impresión QA con importe cero. No habilita cobros LIVE.
const QA_PRINT_MARKER="QA_PRINT_SMOKE_TEST_ONLY";
function allowQaPrintFixture(){
 return process.env.OPS_LOCAL_FIRST==="true" &&
   process.env.OPS_QA_MODE==="true" &&
   process.env.POS_LIVE_ENABLED==="false" &&
   process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa" &&
   process.env.DEFAULT_STORE_CODE==="QA-TEPEXI" &&
   !process.env.VERCEL && !process.env.VERCEL_ENV;
}
// Filtros equivalentes para la sonda SQL y la validación transaccional.
function printFeedScopeSql(){
 if(!allowQaPrintFixture())return sql`o.mode='LIVE'`;
 // Solo la primera orden SHADOW del POS reservada por createShadowOrder.
 // El resto de los espejos (incluidos los anteriores) queda bloqueado.
 const qaPilot=qaPosPrintPilotEnabled()?sql` OR (
   o.mode='SHADOW' AND o.folio LIKE ${QA_POS_PILOT_PREFIX+"%"}
   AND o.status='SENT' AND o.paid_at IS NULL
   AND o.inventory_effect_applied=false AND o.loyalty_effect_applied=false
 )`:sql``;
 return sql`(o.mode='LIVE' OR (
   o.mode='SHADOW' AND o.folio LIKE 'QA-PRINT-%'
   AND o.note=${QA_PRINT_MARKER} AND o.status='SENT'
   AND o.paid_at IS NULL AND o.total=0
   AND o.inventory_effect_applied=false AND o.loyalty_effect_applied=false
 ) ${qaPilot})`;
}
function printOrderScopeDrizzle(){
 const live=eq(posOrders.mode,"LIVE");
 if(!allowQaPrintFixture())return live;
 const fixture=and(
   eq(posOrders.mode,"SHADOW"),like(posOrders.folio,"QA-PRINT-%"),
   eq(posOrders.note,QA_PRINT_MARKER),eq(posOrders.status,"SENT"),
   isNull(posOrders.paidAt),eq(posOrders.total,"0.00"),
   eq(posOrders.inventoryEffectApplied,false),
   eq(posOrders.loyaltyEffectApplied,false),
 );
 if(!qaPosPrintPilotEnabled())return or(live,fixture);
 const pilot=and(
   eq(posOrders.mode,"SHADOW"),like(posOrders.folio,QA_POS_PILOT_PREFIX+"%"),
   eq(posOrders.status,"SENT"),isNull(posOrders.paidAt),
   eq(posOrders.inventoryEffectApplied,false),
   eq(posOrders.loyaltyEffectApplied,false),
 );
 return or(live,fixture,pilot);
}

async function principal({deferPermissionCheck=false}:{deferPermissionCheck?:boolean}={}){
 const {user,employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sin sucursal operativa");
 // La sonda del feed valida pos.sell EN LA MISMA consulta. Las acciones de
 // reclamar, finalizar, latido y otras rutas conservan el chequeo explícito.
 if(!deferPermissionCheck)
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
export async function getPrintStationJobs(input:FeedInput):Promise<HubFeed|HubJob[]>{
 const {since,lastVersion}=input;
 // Las estaciones que mantienen una pestaña anterior no envían lastVersion.
 // Compatibilidad: responderles la lista antigua hasta que recarguen OPS.
 const legacyClient=!Object.prototype.hasOwnProperty.call(input,"lastVersion");
 if(process.env.VERCEL_ENV==="preview")return legacyClient?[]:{jobs:[],version:"preview"};
 // Sonda liviana en una sola consulta: si no hubo cambios, no descargar
 // órdenes, líneas, pagos ni auditorías completas cada cuatro segundos.
 // La identidad del empleado y pos.sell se comprueban SIEMPRE en el servidor.
 const userId=await getVerifiedHotPathUserId();
 const organizationSlug=process.env.DEFAULT_ORGANIZATION_SLUG??"cafe-epico";
 const start=efficientPrintFeedSince(allowedSince(since)),db=getDb();
 const after=start.toISOString();
 // Restricción de QA aplicada a las tres marcas de versión del feed.
 const printable=printFeedScopeSql();
 // La identidad, empleado activo, alcance de sucursal y pos.sell se comprueban
 // en UN viaje a PostgreSQL. El JWT se verifica ANTES de ejecutar la sonda.
 // Sin caché entre requests: revocar permisos/empleados actúa inmediatamente.
 let employee:{id:string;organizationId:string};
 let storeId="";
 let version="fallback:"+Date.now().toString();
 let permissionGranted:boolean|null=null;
 try{
 const probe=await db.execute(sql`
   with staff as (
     select e.id,e.organization_id,e.home_store_id
     from public.employees e
     join public.organizations org on org.id=e.organization_id
     where e.user_id=${userId}::uuid
       and org.slug=${organizationSlug}
       and e.is_active=true
     limit 1
   ), access as (
     select s.id,s.organization_id,s.home_store_id,
       exists (
         select 1 from public.employee_roles er
         join public.role_permissions rp on rp.role_id=er.role_id
         join public.permissions p on p.id=rp.permission_id
         where er.employee_id=s.id
           and p.code='pos.sell'
           and (er.store_id is null or er.store_id=s.home_store_id)
       ) as allowed
     from staff s
   )
   select access.id as employee_id,access.organization_id,access.home_store_id,
     access.allowed,
     case when access.allowed and access.home_store_id is not null then
       coalesce((select max(o.updated_at)::text from public.pos_orders o
         where o.organization_id=access.organization_id
           and o.store_id=access.home_store_id and ${printable}
           and (o.updated_at>=${after}::timestamptz or o.created_at>=${after}::timestamptz)), '') || '|' ||
       coalesce((select max(l.created_at)::text from public.pos_order_lines l
         inner join public.pos_orders o on o.id=l.order_id
         where o.organization_id=access.organization_id
           and o.store_id=access.home_store_id and ${printable}
           and l.created_at>=${after}::timestamptz), '') || '|' ||
       coalesce((select max(s.paid_at)::text from public.pos_order_splits s
         inner join public.pos_orders o on o.id=s.order_id
         where o.organization_id=access.organization_id
           and o.store_id=access.home_store_id and ${printable}
           and s.paid_at>=${after}::timestamptz), '') || '|' ||
       coalesce((select max(a.created_at)::text from public.audit_events a
         where a.organization_id=access.organization_id
           and a.store_id=access.home_store_id and a.entity_type='pos_print_job'
           and a.created_at>=${after}::timestamptz), '')
     else null end as version
   from access
 `);
 const row=probe[0] as {employee_id?:string;organization_id?:string;
   home_store_id?:string|null;allowed?:boolean;version?:string|null}|undefined;
 if(!row?.employee_id||!row.organization_id||!row.home_store_id||
     typeof row.allowed!=="boolean")
   throw new Error("Identidad o sucursal no resuelta en la sonda.");
 employee={id:row.employee_id,organizationId:row.organization_id};
 storeId=row.home_store_id;
 permissionGranted=row.allowed;
 version=typeof row.version==="string"?row.version:"";
 }catch{
   // Bootstrap, errores SQL y sesiones no vinculadas usan la ruta original,
   // que vuelve a verificar empleado activo, sucursal y pos.sell antes de leer.
   const original=await principal();
   employee=original.employee;
   storeId=original.storeId;
   version="fallback:"+Date.now().toString()+":"+Math.random().toString(36).slice(2);
 }
 if(permissionGranted===false)throw new Error("Missing permission: pos.sell");
 if(permissionGranted===null)await assertEmployeePermission(employee.id,"pos.sell",storeId);
 if(typeof lastVersion==="string"&&lastVersion===version)return {jobs:[],version};
 // El feed completo mantiene intactas la deduplicación, la antigüedad máxima,
 // las rondas de comanda y la generación de tickets con puntos/pagos.
 const orders=await db.select({order:posOrders,employeeName:employees.name,customerName:posCustomers.name,customerBalance:posCustomers.pointsBalance})
   .from(posOrders).leftJoin(employees,eq(employees.id,posOrders.employeeId))
   .leftJoin(posCustomers,eq(posCustomers.id,posOrders.customerId))
   .where(and(eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,storeId),printOrderScopeDrizzle(),
      or(gte(posOrders.updatedAt,start),gte(posOrders.createdAt,start))))
   .orderBy(desc(posOrders.updatedAt)).limit(150);
 if(!orders.length)return legacyClient?[]:{jobs:[],version};
 const ids=orders.map(r=>r.order.id);
 const [lines,splits,splitLines,payments,audits,earnRows]=await Promise.all([
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
  db.select({orderId:posLoyaltyEntries.orderId,customerId:posLoyaltyEntries.customerId,
    name:posCustomers.name,balance:posCustomers.pointsBalance,
    points:posLoyaltyEntries.points,note:posLoyaltyEntries.note})
    .from(posLoyaltyEntries)
    .innerJoin(posCustomers,eq(posCustomers.id,posLoyaltyEntries.customerId))
    .where(and(eq(posLoyaltyEntries.organizationId,employee.organizationId),
      eq(posLoyaltyEntries.entryType,"EARN"),inArray(posLoyaltyEntries.orderId,ids))),
 ]);
 const stopped=new Set(audits.filter(e=>
   e.action==="POS_PRINT_HUB_DONE"||e.action==="POS_PRINT_HUB_FAILED"||e.action==="POS_PRINT_HUB_EXPIRED")
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
      extra:extraLabels(line.expectedConsumption,{showPrices:true}).join(" · ")||null,
      note:(line.expectedConsumption?.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí")+
        (line.note?" · "+line.note:""),
      total:money(Number(line.lineTotal))}));
  const earned=earnRows.filter(row=>row.orderId===order.id);
  const loyaltyFor=(splitLabel:string|null)=>receiptLoyaltyView({
    entries:earned,splitLabel,fallbackCustomer:entry.customerName,
    fallbackBalance:entry.customerBalance,cancelled:order.status==="CANCELLED",
  });
  const paymentExtras=(methods:typeof payments)=>{
    const redeemed=methods.filter(p=>p.method==="POINTS").reduce((n,p)=>n+Number(p.amount),0);
    const cash=methods.filter(p=>p.method==="CASH");
    const completeCash=cash.length>0&&cash.every(p=>p.tenderedAmount!==null&&p.changeAmount!==null);
    return {
      payment:methods.map(p=>(p.method==="CASH"?"Efectivo":
        p.method==="CARD"?"Tarjeta":p.method==="TRANSFER"?"Transferencia":
        p.method==="POINTS"?"Puntos":p.method)+" "+money(Number(p.amount))).join(" + "),
      cashTendered:completeCash?money(cash.reduce((n,p)=>n+Number(p.tenderedAmount),0)):null,
      cashChange:completeCash?money(cash.reduce((n,p)=>n+Number(p.changeAmount),0)):null,
      pointsRedeemed:redeemed>0?redeemed.toFixed(2):null,
      monetaryPaid:redeemed>0?money(methods.filter(p=>p.method!=="POINTS")
        .reduce((n,p)=>n+Number(p.amount),0)):null,
    };
  };
  const base={folio:order.folio,kind:"RECEIPT" as const,
    status:order.status,date:(order.paidAt??order.createdAt)
      .toLocaleString("es-MX",{timeZone:"America/Mexico_City"}),
    employee:entry.employeeName??"Equipo",service:order.serviceMode==="TAKEAWAY"?"Para llevar":"Aquí"};
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
          ...base,status:"PAID",date:split.paidAt.toLocaleString("es-MX",{
            timeZone:"America/Mexico_City",dateStyle:"short",timeStyle:"short"}),
          ...loyaltyFor(split.label),...paymentExtras(methods),
          splitLabel:split.label,items:receiptLines(parts),
          total:money(Number(split.total)),
        }});
    }
  }else if(order.status==="PAID"&&order.paidAt&&order.paidAt>=start){
    const key="RECEIPT:"+order.id;
    if(stopped.has(key))continue;
    const methods=payments.filter(p=>p.orderId===order.id);
    jobs.push({key,orderId:order.id,kind:"RECEIPT",
      createdAt:order.paidAt.toISOString(),title:"Ticket "+order.folio,
      ticket:{...base,...loyaltyFor(null),...paymentExtras(methods),
        items:receiptLines(linesFor),total:money(Number(order.total)),
        payment:paymentExtras(methods).payment||"Sin cobro · consumo interno"}});

  }
 }
 for(const event of audits){
  if(event.action==="POS_KITCHEN_VOID_PRINT_REQUESTED"&&!stopped.has(event.entityId)){
    const match=/^VOID:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(event.entityId);
    if(match){
      const current=orders.find(x=>x.order.id===match[1])?.order;
      const slip=event.afterData?.slip as Record<string,unknown>|undefined;
      if(current&&slip&&Array.isArray(slip.lines)&&typeof slip.folio==="string"&&
         typeof slip.table==="string"){
        jobs.push({key:event.entityId,orderId:match[1],kind:"VOID",
          createdAt:event.createdAt.toISOString(),title:"ANULACIÓN "+current.folio,
          slip:slip as unknown as KitchenSlip});
      }
    }
  }
  if(event.action!=="POS_PREBILL_PRINT_REQUESTED"||stopped.has(event.entityId))continue;
  const match=/^PREBILL:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(event.entityId);
  if(!match)continue;
  const current=orders.find(x=>x.order.id===match[1])?.order;
  if(!current||!["SENT","PREPARING","READY","PARTIALLY_PAID"].includes(current.status))continue;
  const payload=event.afterData?.ticket as Record<string,unknown>|undefined;
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||
     payload.kind!=="PREBILL"||!Array.isArray(payload.items))continue;
  jobs.push({key:event.entityId,orderId:match[1],kind:"PREBILL",
    createdAt:event.createdAt.toISOString(),
    title:"Precuenta "+(current.tableLabel??current.folio),
    ticket:payload as unknown as DirectReceiptPayload});
 }
 jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||
   (a.kind==="KITCHEN"?-1:1));
 return legacyClient?jobs.slice(0,30):{jobs:jobs.slice(0,30),version};
}
async function verifyJob(jobKey:string,org:string,store:string,tx:Pick<ReturnType<typeof getDb>,"select">){
 const match=/^(KITCHEN|RECEIPT|PREBILL|VOID):([0-9a-f-]{36})(?::([A-Za-z0-9_-]{1,120}))?$/i.exec(jobKey);
 if(!match)throw new Error("Trabajo de impresión inválido.");
 const [order]=await tx.select({id:posOrders.id}).from(posOrders).where(and(
  eq(posOrders.id,match[2]),eq(posOrders.organizationId,org),
  eq(posOrders.storeId,store),printOrderScopeDrizzle())).limit(1);
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
      e.action==="POS_PRINT_HUB_FAILED"||e.action==="POS_PRINT_HUB_EXPIRED"))return false;
  // Seguridad primero: si una estación reclamó un trabajo y se desconectó,
  // NO enviarlo otra vez automáticamente. Puede haber impreso papel antes de
  // perder el ACK. Exige conciliación y reimpresión manual supervisada.
  if(events.some(e=>e.action==="POS_PRINT_HUB_CLAIMED"))return false;
  // Defensivo en servidor: un navegador suspendido no puede mandar papel atrasado.
  // Se marca como vencida y solo el operador podrá solicitar una impresión manual.
  let initiatedAt:Date|null=null;
  if(jobKey.startsWith("KITCHEN:")){
    const match=/^KITCHEN:([0-9a-f-]{36}):([A-Za-z0-9_-]{1,120})$/i.exec(jobKey);
    if(match){
      const rows=await tx.select({createdAt:posOrderLines.createdAt,
        expectedConsumption:posOrderLines.expectedConsumption})
        .from(posOrderLines).where(eq(posOrderLines.orderId,match[1]));
      const roundRows=rows.filter(row=>
        (typeof row.expectedConsumption?.roundId==="string"?
          row.expectedConsumption.roundId:"INITIAL")===match[2]);
      if(roundRows.length)initiatedAt=new Date(Math.min(...roundRows.map(row=>row.createdAt.getTime())));
    }
  }else if(jobKey.startsWith("RECEIPT:")){
    const match=/^RECEIPT:([0-9a-f-]{36})(?::([0-9a-f-]{36}))?$/i.exec(jobKey);
    if(match?.[2]){
      const [split]=await tx.select({paidAt:posOrderSplits.paidAt}).from(posOrderSplits)
        .where(and(eq(posOrderSplits.id,match[2]),eq(posOrderSplits.orderId,match[1]))).limit(1);
      initiatedAt=split?.paidAt??null;
    }else if(match){
      const [order]=await tx.select({paidAt:posOrders.paidAt}).from(posOrders)
        .where(eq(posOrders.id,match[1])).limit(1);
      initiatedAt=order?.paidAt??null;
    }
  }else if(jobKey.startsWith("VOID:")||jobKey.startsWith("PREBILL:")){
    const [requested]=await tx.select({createdAt:auditEvents.createdAt}).from(auditEvents)
      .where(and(eq(auditEvents.entityType,"pos_print_job"),
        eq(auditEvents.entityId,jobKey))).orderBy(auditEvents.createdAt).limit(1);
    initiatedAt=requested?.createdAt??null;
  }
  if(!initiatedAt||Date.now()-initiatedAt.getTime()>MAX_AUTO_PRINT_AGE_MS||
      initiatedAt.getTime()>Date.now()+60_000){
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_PRINT_HUB_EXPIRED",entityType:"pos_print_job",entityId:jobKey,
      afterData:{stationId,reason:"STALE_OR_INVALID_TIMESTAMP",
        createdAt:initiatedAt?.toISOString()??null,requiresManualReview:true},
    });
    return false;
  }
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
 Promise<"UNCLAIMED"|"CLAIMED"|"DONE"|"FAILED"|"EXPIRED">{
 const {employee,storeId}=await principal();
 const db=getDb();
 await verifyJob(jobKey,employee.organizationId,storeId,db);
 const events=await db.select({action:auditEvents.action}).from(auditEvents)
  .where(and(eq(auditEvents.organizationId,employee.organizationId),
    eq(auditEvents.entityType,"pos_print_job"),eq(auditEvents.entityId,jobKey)))
  .orderBy(desc(auditEvents.createdAt)).limit(15);
 if(events.some(row=>row.action==="POS_PRINT_HUB_DONE"))return "DONE";
 if(events.some(row=>row.action==="POS_PRINT_HUB_FAILED"))return "FAILED";
 if(events.some(row=>row.action==="POS_PRINT_HUB_EXPIRED"))return "EXPIRED";
 if(events.some(row=>row.action==="POS_PRINT_HUB_CLAIMED"))return "CLAIMED";
 return "UNCLAIMED";
}

/** Consultar configuración solo tras activar esta PC. */
export async function getPrintStationTemplate(){
 const {employee}=await principal();
 const {getPosPrintSettings}=await import("@/src/application/pos/print-settings");
 return getPosPrintSettings(employee.organizationId);
}

/** Una fila de estado por sucursal, sin escritura perpetua de eventos de auditoría.
 * Los eventos CLAIM/DONE/FAILED/EXPIRED de cada trabajo siguen inmutables.
 */
export async function heartbeatPrintStation(input:{
  stationId:string;since:string;bridgeReady:boolean;
}){
  assertNoPreviewMutation();
  const {employee,storeId}=await principal();
  if(!/^[0-9a-f-]{36}$/i.test(input.stationId))throw new Error("Estación inválida.");
  allowedSince(input.since);
  await getDb().insert(posPrintStationStatus).values({
    organizationId:employee.organizationId,storeId,
    stationId:input.stationId,bridgeReady:input.bridgeReady,
  }).onConflictDoUpdate({
    target:posPrintStationStatus.storeId,
    set:{stationId:input.stationId,bridgeReady:input.bridgeReady,
      lastSeen:sql`now()`},
  });
}

/** Salud por PK, sin recorrer miles de eventos. */
export async function getPrintStationHealth(){
 const {employee,storeId}=await principal();
 const [last]=await getDb().select({
   at:posPrintStationStatus.lastSeen,
   bridgeReady:posPrintStationStatus.bridgeReady,
 }).from(posPrintStationStatus).where(and(
   eq(posPrintStationStatus.organizationId,employee.organizationId),
   eq(posPrintStationStatus.storeId,storeId),
 )).limit(1);
 const online=Boolean(last&&Date.now()-last.at.getTime()<HEARTBEAT_TIMEOUT_MS);
 return {online,bridgeReady:last?.bridgeReady===true,
   lastSeen:last?.at.toISOString()??null};
}
