import {and,eq,gte,inArray,lte} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {posOrders,posOrderLines,posPayments} from "@/src/infrastructure/db/schema";

const ZONE="America/Mexico_City";
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const mx=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const shape=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const dayKey=(d:Date)=>new Intl.DateTimeFormat("en-CA",{
  timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit",
}).format(d);
const utc=(date:string)=>new Date(date+"T00:00:00.000Z");
const move=(date:string,days:number)=>new Date(utc(date).getTime()+days*86400000).toISOString().slice(0,10);
export function parseSalesRange(from:unknown,to:unknown){
 const today=dayKey(new Date()),start=typeof from==="string"?from:today;
 const end=typeof to==="string"?to:today;
 const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(utc(v).valueOf())
   &&utc(v).toISOString().slice(0,10)===v;
 if(!valid(start)||!valid(end)||start>end||end>today)throw new Error("Rango de fechas inválido");
 const length=Math.round((utc(end).getTime()-utc(start).getTime())/86400000)+1;
 if(length>366)throw new Error("Selecciona un periodo de máximo 366 días.");
 return {from:start,to:end,days:length,priorFrom:move(start,-length),
   priorTo:move(start,-1)};
}
type Line=typeof posOrderLines.$inferSelect;
type ItemRow={name:string;units:number;gross:number;net:number;discount:number;cogs:number;complete:boolean;lines:number;costed:number};
function costSnapshot(line:Line){
 const c=shape(line.expectedConsumption);
 const parts=Array.isArray(c.components)?c.components:[];
 let known=0,costed=0;
 for(const p of parts){
  const data=shape(shape(p).costOnlyMeasure),value=data.estimatedCostMxn;
  if(value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))&&Number(value)>=0){
   known+=Number(value);costed++;
  }
 }
 return {cogs:mx(known),complete:parts.length>0&&costed===parts.length};
}
function addRow(map:Map<string,ItemRow>,name:string,value:Omit<ItemRow,"name"|"lines"|"costed">){
 const row=map.get(name)??{name,units:0,gross:0,net:0,discount:0,cogs:0,complete:true,lines:0,costed:0};
 row.units+=value.units;row.gross+=value.gross;row.net+=value.net;row.discount+=value.discount;
 row.cogs+=value.cogs;row.complete&&=value.complete;row.lines++;
 if(value.complete)row.costed++;
 map.set(name,row);
}
function sums(rows:Array<{gross:number;net:number;discount:number;cogs:number;complete:boolean}>){
 const net=mx(rows.reduce((s,v)=>s+v.net,0)),gross=mx(rows.reduce((s,v)=>s+v.gross,0));
 const cogs=mx(rows.reduce((s,v)=>s+v.cogs,0));
 const complete=rows.length>0&&rows.every(v=>v.complete);
 return {gross,net,discounts:mx(rows.reduce((s,v)=>s+v.discount,0)),
  cogsKnown:cogs,cogsComplete:complete,
  grossBenefit:complete?mx(net-cogs):null,
  marginPct:complete&&net>0?(net-cogs)/net*100:null,
  coverage:rows.length?rows.filter(v=>v.complete).length/rows.length*100:0,
 };
}
export async function getSalesPeriodReport(orgId:string,range:ReturnType<typeof parseSalesRange>){
 const db=getDb();
 const start=new Date(utc(range.priorFrom).getTime()-86400000);
 const end=new Date(utc(range.to).getTime()+2*86400000);
 const orders=await db.select().from(posOrders).where(and(
  eq(posOrders.organizationId,orgId),eq(posOrders.mode,"LIVE"),
  eq(posOrders.status,"PAID"),gte(posOrders.paidAt,start),lte(posOrders.paidAt,end)));
 const filtered=orders.filter(x=>x.paidAt&&
  dayKey(x.paidAt)>=range.priorFrom&&dayKey(x.paidAt)<=range.to);
 const ids=filtered.map(x=>x.id);
 const [lines,payments]=ids.length?await Promise.all([
  db.select().from(posOrderLines).where(and(
    eq(posOrderLines.organizationId,orgId),inArray(posOrderLines.orderId,ids))),
  db.select().from(posPayments).where(and(
    eq(posPayments.organizationId,orgId),inArray(posPayments.orderId,ids))),
 ]):[[],[]];
 const mapped=new Map<string,Line[]>();
 for(const line of lines){
   const arr=mapped.get(line.orderId)??[];arr.push(line);mapped.set(line.orderId,arr);
 }
 const saleRows=filtered.map(order=>{
  const l=mapped.get(order.id)??[];
  const gross=l.reduce((sum,line)=>{
    const detail=shape(shape(line.expectedConsumption).discount);
    const explicit=Math.max(0,n(detail.total));
    return sum+Math.max(n(line.lineTotal),n(line.unitPrice)*n(line.quantity))+explicit;
  },0);
  const discounts=l.reduce((sum,line)=>{
    const explicit=Math.max(0,n(shape(shape(line.expectedConsumption).discount).total));
    return sum+Math.max(0,n(line.unitPrice)*n(line.quantity)-n(line.lineTotal))+explicit;
  },0);
  const computed=l.map(costSnapshot);
  return {orderId:order.id,date:dayKey(order.paidAt!),net:n(order.total),
   gross:Math.max(gross,n(order.total)+discounts),discounts,
   discount:discounts,cogs:computed.reduce((s,c)=>s+c.cogs,0),
   complete:l.length>0&&computed.every(c=>c.complete),
   units:l.reduce((s,x)=>s+n(x.quantity),0)};
 });
 const current=saleRows.filter(x=>x.date>=range.from&&x.date<=range.to);
 const prior=saleRows.filter(x=>x.date>=range.priorFrom&&x.date<=range.priorTo);
 const metrics=sums(current),before=sums(prior);
 const toRow=(r:ItemRow)=>({...r,gross:mx(r.gross),net:mx(r.net),
    discount:mx(r.discount),cogs:mx(r.cogs),
    contribution:r.complete?mx(r.net-r.cogs):null,
    marginPct:r.complete&&r.net>0?(r.net-r.cogs)/r.net*100:null,
    coverage:r.lines?r.costed/r.lines*100:0});
 const byProduct=new Map<string,ItemRow>(),byCategory=new Map<string,ItemRow>();
 const prevUnits=new Map<string,number>();
 const currentIds=new Set(current.map(x=>x.orderId)),
  previousIds=new Set(prior.map(x=>x.orderId));
 for(const line of lines){
  if(previousIds.has(line.orderId))
    prevUnits.set(line.nameSnapshot,(prevUnits.get(line.nameSnapshot)??0)+n(line.quantity));
  if(!currentIds.has(line.orderId))continue;
  const qty=n(line.quantity),total=n(line.lineTotal);
  const explicit=Math.max(0,n(shape(shape(line.expectedConsumption).discount).total));
  const gross=Math.max(n(line.unitPrice)*qty,total)+explicit;
  const cost=costSnapshot(line);
  const values={units:qty,net:total,gross,discount:Math.max(0,gross-total),
    cogs:cost.cogs,complete:cost.complete};
  addRow(byProduct,line.nameSnapshot,values);
  addRow(byCategory,line.categorySnapshot,values);
 }
 const products=[...byProduct.values()].map(toRow).sort((a,b)=>b.net-a.net);
 const categories=[...byCategory.values()].map(toRow).sort((a,b)=>b.net-a.net);
 const days=Array.from({length:range.days},(_,i)=>{
  const date=move(range.from,i),rows=current.filter(x=>x.date===date);
  return {date,...sums(rows),tickets:rows.length,
   units:rows.reduce((s,x)=>s+x.units,0)};
 });
 const methods=new Map<string,number>();
 for(const p of payments){
  if(!currentIds.has(p.orderId))continue;
  const label=p.method==="CASH"?"Efectivo":p.method==="CARD"?"Tarjeta":
   p.method==="TRANSFER"?"Transferencia":p.method==="POINTS"?"Puntos":p.method;
  methods.set(label,(methods.get(label)??0)+n(p.amount));
 }
 const trends=products.map(x=>{
  const previous=prevUnits.get(x.name)??0;
  return {...x,previous,
   deltaUnits:x.units-previous,changePct:previous>0?(x.units-previous)/previous*100:null};
 }).filter(x=>x.units>=2||x.previous>=2)
  .sort((a,b)=>Math.abs(b.deltaUnits)-Math.abs(a.deltaUnits)).slice(0,12);
 const diff=before.net>0?(metrics.net-before.net)/before.net*100:null;
 return {range,metrics,comparison:{...before,netChangePct:diff},
   tickets:current.length,avgTicket:current.length?metrics.net/current.length:0,
   units:current.reduce((s,x)=>s+x.units,0),days,products,categories,trends,
   methods:[...methods].map(([name,value])=>({name,value:mx(value)})),
   availableFrom:filtered.reduce<string|null>((p,o)=>!p||dayKey(o.paidAt!)<p?dayKey(o.paidAt!):p,null),
   source:"OPS_LIVE" as const};
}
