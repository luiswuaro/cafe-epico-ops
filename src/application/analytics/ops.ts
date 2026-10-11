import {and,eq,gte,inArray} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {posOrders,posOrderLines,posPayments,posCustomers} from "@/src/infrastructure/db/schema";

/** Fuente exclusiva: órdenes OPS LIVE pagadas y vigentes. Nunca se mezclan
 * SHADOW, cancelaciones, tickets guardados ni recibos de Loyverse. */
const TZ="America/Mexico_City";
const number=(v:unknown)=>{const x=Number(v??0);return Number.isFinite(x)?x:0;};
const money=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const local=(d:Date)=>{
 const ps=new Intl.DateTimeFormat("en-CA",{
   timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",
   hour:"2-digit",hourCycle:"h23",
 }).formatToParts(d);
 const p=(k:string)=>ps.find(r=>r.type===k)?.value??"";
 return {date:[p("year"),p("month"),p("day")].join("-"),hour:Number(p("hour"))};
};
const daysAgo=(n:number,now=new Date())=>local(new Date(now.getTime()-n*86_400_000)).date;
const change=(a:number,b:number)=>b===0?null:(a-b)/b*100;
const COSTABLE=(v:unknown):number|null=>{
 if(v==null||v==="")return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;
};
type Order=typeof posOrders.$inferSelect;
type SaleLine=typeof posOrderLines.$inferSelect;
type Sale={
 id:string;paid:Date;day:string;hour:number;total:number;gross:number;discounts:number;
 cogs:number;cogsComplete:boolean;units:number;beverageUnits:number;
 customerId:string|null;service:string;
};
type Row={qty:number;sales:number;cogs:number;complete:boolean;discounts:number;knownLines:number;totalLines:number};
function lineCost(line:SaleLine){
 const receipt=obj(line.expectedConsumption);
 const components=Array.isArray(receipt.components)?receipt.components:[];
 let known=0,priced=0;
 for(const raw of components){
   const c=obj(raw),m=obj(c.costOnlyMeasure);
   const cost=COSTABLE(m.estimatedCostMxn);
   if(cost!==null){known+=cost;priced++;}
 }
 return {known:money(known),complete:components.length>0&&priced===components.length,
   priced,total:components.length};
}
function isFood(category:string){return category.toUpperCase()==="ALIMENTOS";}
function emptyRow():Row{return {qty:0,sales:0,cogs:0,complete:true,discounts:0,knownLines:0,totalLines:0};}
export async function getBusinessAnalytics(organizationId:string){
 const db=getDb();
 const now=new Date();
 const from=new Date(now.getTime()-65*86_400_000);
 const [orders,customers]=await Promise.all([
   db.select().from(posOrders).where(and(
     eq(posOrders.organizationId,organizationId),eq(posOrders.mode,"LIVE"),
     eq(posOrders.status,"PAID"),gte(posOrders.paidAt,from),
   )),
   db.select().from(posCustomers).where(and(
     eq(posCustomers.organizationId,organizationId),eq(posCustomers.isActive,true),
   )),
 ]);
 const validOrders=orders.filter(o=>o.paidAt instanceof Date && o.paidAt<=now);
 const ids=validOrders.map(o=>o.id);
 const [lines,payments]=ids.length?await Promise.all([
   db.select().from(posOrderLines).where(and(
     eq(posOrderLines.organizationId,organizationId),inArray(posOrderLines.orderId,ids),
   )),
   db.select().from(posPayments).where(and(
     eq(posPayments.organizationId,organizationId),inArray(posPayments.orderId,ids),
   )),
 ]):[[],[]];
 const byOrder=new Map<string,SaleLine[]>();
 for(const line of lines)byOrder.set(line.orderId,[...(byOrder.get(line.orderId)??[]),line]);
 const all:Sale[]=validOrders.map(order=>{
   const paid=order.paidAt!;
   const parts=local(paid),rows=byOrder.get(order.id)??[];
   let gross=0,discounts=0,cogs=0,complete=rows.length>0,units=0,beverageUnits=0;
   for(const line of rows){
     const qty=number(line.quantity),snapshot=obj(line.expectedConsumption);
     const discount=obj(snapshot.discount);
     const explicitDiscount=COSTABLE(discount.total)??0;
     const before=number(line.unitPrice)*qty;
     const net=number(line.lineTotal);
     gross+=Math.max(before,net)+explicitDiscount;
     discounts+=Math.max(0,before-net)+explicitDiscount;
     const cost=lineCost(line);
     cogs+=cost.known;
     if(!cost.complete)complete=false;
     units+=qty;
     if(!isFood(line.categorySnapshot))beverageUnits+=qty;
   }
   const total=number(order.total);
   if(!rows.length){gross=total;complete=false;}
   return {id:order.id,paid,day:parts.date,hour:parts.hour,total,
     gross:Math.max(gross,total),discounts,cogs,units,beverageUnits,
     cogsComplete:complete,customerId:order.customerId,service:order.serviceMode};
 });
 const today=local(now).date;
 function range(days:number,offset=0){
   const set=new Set<string>();
   for(let n=offset;n<offset+days;n++)set.add(daysAgo(n,now));
   return set;
 }
 function agg(keys:Set<string>){
   const rows=all.filter(x=>keys.has(x.day));
   const sales=rows.reduce((a,x)=>a+x.total,0);
   const gross=rows.reduce((a,x)=>a+x.gross,0);
   const discounts=rows.reduce((a,x)=>a+x.discounts,0);
   const cogs=rows.reduce((a,x)=>a+x.cogs,0);
   const units=rows.reduce((a,x)=>a+x.units,0);
   const identified=rows.filter(x=>x.customerId).length;
   const morning=rows.filter(x=>x.hour<16),afternoon=rows.filter(x=>x.hour>=16);
   const sum=(list:Sale[])=>list.reduce((a,x)=>a+x.total,0);
   return {sales:money(sales),grossSales:money(gross),discounts:money(discounts),
     discountRate:gross>0?discounts/gross*100:0,cogs:money(cogs),
     cogsComplete:rows.length>0&&rows.every(x=>x.cogsComplete),
     costCoveragePct:rows.length?rows.filter(x=>x.cogsComplete).length/rows.length*100:0,
     contribution:money(sales-cogs),contributionPct:sales>0?(sales-cogs)/sales*100:0,
     tickets:rows.length,avgTicket:rows.length?sales/rows.length:0,
     units,itemsPerTicket:rows.length?units/rows.length:0,
     tax:0,tips:0,identifiedTickets:identified,
     captureRate:rows.length?identified/rows.length*100:0,
     morningSales:money(sum(morning)),afternoonSales:money(sum(afternoon)),
     morningTickets:morning.length,afternoonTickets:afternoon.length,
     morningBeverageUnits:morning.reduce((a,x)=>a+x.beverageUnits,0),
     afternoonBeverageUnits:afternoon.reduce((a,x)=>a+x.beverageUnits,0),
   };
 }
 const defs=([
   {key:"today",label:"Hoy",days:1},
   {key:"7d",label:"7 días",days:7},
   {key:"15d",label:"15 días",days:15},
   {key:"30d",label:"30 días",days:30},
 ] as const);
 const periods=defs.map(def=>{
   const a=agg(range(def.days));
   const old=def.days<30?agg(range(def.days,def.days)):null;
   return {...def,...a,previousSales:old?.sales??null,
     previousTickets:old?.tickets??null,
     salesChangePct:old?change(a.sales,old.sales):null,
     ticketsChangePct:old?change(a.tickets,old.tickets):null,
     avgTicketChangePct:old?change(a.avgTicket,old.avgTicket):null};
 });
 const keys30=range(30);
 const recent=all.filter(x=>keys30.has(x.day));
 const daily=[...keys30].sort().map(date=>({date,...agg(new Set([date]))}));
 const hours=new Map<number,{hour:number;tickets:number;sales:number}>();
 for(const x of recent){
   const row=hours.get(x.hour)??{hour:x.hour,tickets:0,sales:0};
   row.tickets++;row.sales+=x.total;hours.set(x.hour,row);
 }
 const hourly=[...hours.values()].sort((a,b)=>a.hour-b.hour);
 const top=new Map<string,Row>(),categories=new Map<string,Row>();
 const id30=new Set(recent.map(x=>x.id));
 for(const line of lines){
   if(!id30.has(line.orderId))continue;
   const cost=lineCost(line),qty=number(line.quantity),sales=number(line.lineTotal);
   const snap=obj(line.expectedConsumption),discount=obj(snap.discount);
   const value=(COSTABLE(discount.total)??0)+Math.max(0,number(line.unitPrice)*qty-sales);
   for(const [map,key] of [[top,line.nameSnapshot],[categories,line.categorySnapshot]] as const){
     const r=map.get(key)??emptyRow();
     r.qty+=qty;r.sales+=sales;r.cogs+=cost.known;r.discounts+=value;
     r.totalLines++;if(cost.complete)r.knownLines++;else r.complete=false;
     map.set(key,r);
   }
 }
 const topProducts=[...top].map(([name,r])=>({
   name,qty:r.qty,sales:money(r.sales),cogs:money(r.cogs),discounts:money(r.discounts),
   contribution:money(r.sales-r.cogs),contributionPct:r.sales>0?(r.sales-r.cogs)/r.sales*100:0,
   configuredCoveragePct:r.totalLines?r.knownLines/r.totalLines*100:0,
   configuredContribution:money(r.sales-r.cogs),
   configuredContributionPct:r.complete&&r.sales>0?(r.sales-r.cogs)/r.sales*100:null,
   effectiveContributionPct:r.complete&&r.sales>0?(r.sales-r.cogs)/r.sales*100:0,
   costBasis:r.complete?"OPS_SNAPSHOT" as const:"PENDING" as const,
   cogsComplete:r.complete,
 })).sort((a,b)=>b.sales-a.sales).slice(0,15);
 const categories30=[...categories].map(([name,r])=>({
   name,qty:r.qty,sales:money(r.sales),cogs:money(r.cogs),
   contribution:money(r.sales-r.cogs),
   contributionPct:r.sales>0?(r.sales-r.cogs)/r.sales*100:0,
   cogsComplete:r.complete,
 })).sort((a,b)=>b.sales-a.sales);
 const paymentTotals=new Map<string,number>();
 for(const payment of payments){
   if(!id30.has(payment.orderId))continue;
   const method=payment.method==="CASH"?"Efectivo":
     payment.method==="CARD"?"Tarjeta":
     payment.method==="TRANSFER"?"Transferencia":
     payment.method==="POINTS"?"Puntos de lealtad":payment.method;
   paymentTotals.set(method,(paymentTotals.get(method)??0)+number(payment.amount));
 }
 const services=new Map<string,{tickets:number;sales:number}>();
 for(const x of recent){
   const key=x.service==="TAKEAWAY"?"Para llevar":x.service==="DINE_IN"?"Para aquí":x.service;
   const old=services.get(key)??{tickets:0,sales:0};
   old.tickets++;old.sales+=x.total;services.set(key,old);
 }
 const customerOrders=new Map<string,{visits:number;spent:number}>();
 for(const x of all){
   if(!x.customerId)continue;
   const old=customerOrders.get(x.customerId)??{visits:0,spent:0};
   old.visits++;old.spent+=x.total;customerOrders.set(x.customerId,old);
 }
 const newCustomers=(n:number)=>customers.filter(c=>range(n).has(local(c.createdAt).date)).length;
 const new7=newCustomers(7),new15=newCustomers(15),new30=newCustomers(30);
 const pace7=new7/7,pace30=new30/30;
 const loyalty={
   customers:customers.length,new7,new15,new30,activated:customerOrders.size,
   repeat:[...customerOrders.values()].filter(x=>x.visits>=2).length,
   averageVisits:customerOrders.size?
     [...customerOrders.values()].reduce((a,x)=>a+x.visits,0)/customerOrders.size:0,
   averageSpent:customerOrders.size?
     [...customerOrders.values()].reduce((a,x)=>a+x.spent,0)/customerOrders.size:0,
   newPerDay7:pace7,newPerDay30:pace30,projected30At7dPace:pace7*30,
   trendPct:pace30>0?(pace7-pace30)/pace30*100:null,
   anonymousTickets30:recent.filter(x=>!x.customerId).length,
 };
 const peakHour=[...hourly].sort((a,b)=>b.sales-a.sales)[0]??null;
 const p30=periods.find(p=>p.key==="30d")!;
 const p7=periods.find(p=>p.key==="7d")!;
 const suggestions:Array<{level:"INFO"|"ACTION";title:string;detail:string}>=[];
 if(p7.ticketsChangePct!==null&&p7.ticketsChangePct<=-8&&
   p7.avgTicketChangePct!==null&&Math.abs(p7.avgTicketChangePct)<5){
   suggestions.push({level:"ACTION",title:"Revisar tráfico de clientes",
     detail:"Los tickets de los últimos siete días bajaron respecto al periodo anterior de OPS."});
 }
 if(p30.tickets>0&&p30.captureRate<40){
   suggestions.push({level:"ACTION",title:"Subir captura de lealtad",
     detail:"Sólo "+p30.captureRate.toFixed(1)+"% de tickets LIVE están ligados a cliente."});
 }
 if(p30.tickets>0&&!p30.cogsComplete){
   suggestions.push({level:"ACTION",title:"Completar costos de los insumos OPS",
     detail:"El margen real está pendiente: hay componentes del snapshot sin costo unitario registrado. No presentamos la contribución parcial como utilidad."});
 }
 return {
   source:"OPS_LIVE" as const,asOf:now.toISOString(),today,
   periods,daily,hourly,
   payments:[...paymentTotals].map(([name,sales])=>({name,sales:money(sales)}))
     .sort((a,b)=>b.sales-a.sales),
   dining:[...services].map(([name,v])=>({name,...v,sales:money(v.sales)}))
     .sort((a,b)=>b.sales-a.sales),
   topProducts,categories30,loyalty,peakHour,suggestions,
 };
}
