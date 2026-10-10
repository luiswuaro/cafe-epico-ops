import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/src/infrastructure/db/client";
import { inventoryBalances, inventoryItems, inventoryMovements, posOrders, posOrderLines } from "@/src/infrastructure/db/schema";

const zone="America/Mexico_City";
const dateKey=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const hourKey=(date:Date)=>Number(new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",hourCycle:"h23"}).format(date));
const round3=(v:number)=>Math.round(v*1000)/1000;

// No utiliza ninguna tabla de Loyverse. Pronostica sólo tras >=3 días
// distintos con cobros LIVE de OPS, y nunca extrapola un historial vacío.
export async function getOpsInventoryIntelligence(organizationId:string,storeId:string){
  const db=getDb(),now=new Date(),since=new Date(Date.now()-14*86_400_000);
  const [balances,movements,paidOrders]=await Promise.all([
    db.select({id:inventoryItems.id,name:inventoryItems.name,
      unit:inventoryItems.canonicalUnit,minimum:inventoryItems.minimumStock,
      theoretical:inventoryBalances.theoreticalQuantity})
      .from(inventoryBalances).innerJoin(inventoryItems,eq(inventoryItems.id,inventoryBalances.inventoryItemId))
      .where(and(eq(inventoryBalances.organizationId,organizationId),
        eq(inventoryBalances.storeId,storeId),eq(inventoryItems.isActive,true),
        eq(inventoryItems.trackingType,"QUANTITY"))),
    db.select({itemId:inventoryMovements.inventoryItemId,quantityDelta:inventoryMovements.quantityDelta,
      movementType:inventoryMovements.movementType,sourceType:inventoryMovements.sourceType,
      occurredAt:inventoryMovements.occurredAt}).from(inventoryMovements)
      .where(and(eq(inventoryMovements.organizationId,organizationId),
        eq(inventoryMovements.storeId,storeId),gte(inventoryMovements.occurredAt,since),
        inArray(inventoryMovements.sourceType,["POS_LIVE_ORDER","POS_LIVE_CANCEL"]))),
    db.select({id:posOrders.id,businessDate:posOrders.businessDate,
      paidAt:posOrders.paidAt,total:posOrders.total}).from(posOrders)
      .where(and(eq(posOrders.organizationId,organizationId),eq(posOrders.storeId,storeId),
        eq(posOrders.mode,"LIVE"),eq(posOrders.status,"PAID"),gte(posOrders.paidAt,since)))
      .orderBy(desc(posOrders.paidAt)).limit(3000),
  ]);
  const orderIds=paidOrders.map(o=>o.id);
  const lines=orderIds.length?await db.select({orderId:posOrderLines.orderId,
      name:posOrderLines.nameSnapshot,category:posOrderLines.categorySnapshot,
      quantity:posOrderLines.quantity}).from(posOrderLines)
      .where(and(eq(posOrderLines.organizationId,organizationId),inArray(posOrderLines.orderId,orderIds))):[];
  const observed=new Set(paidOrders.map(o=>o.paidAt?dateKey(o.paidAt):o.businessDate));
  const sampleDays=observed.size>=3?observed.size:0;
  const usage=new Map<string,{total:number,morning:number,afternoon:number}>();
  for(const m of movements){
    if(m.sourceType==="POS_LIVE_ORDER"&&m.movementType!=="SALE")continue;
    const qty=-Number(m.quantityDelta);
    const x=usage.get(m.itemId)??{total:0,morning:0,afternoon:0};
    x.total+=qty;
    if(hourKey(m.occurredAt)<16)x.morning+=qty;else x.afternoon+=qty;
    usage.set(m.itemId,x);
  }
  // Consolidar ubicaciones dentro de la misma sucursal para evitar
  // subestimar el inventario cuando un insumo está en barra y almacén.
  const perItem=new Map<string,{id:string;name:string;unit:string;minimum:string|null;theoretical:number}>();
  for(const row of balances){
    const old=perItem.get(row.id);
    if(old)old.theoretical+=Number(row.theoretical);
    else perItem.set(row.id,{...row,theoretical:Number(row.theoretical)});
  }
  const smartRows=[...perItem.values()].map(b=>{
    const stock=Number(b.theoretical),u=usage.get(b.id)??{total:0,morning:0,afternoon:0};
    const avgDailyUsage14=sampleDays?round3(Math.max(0,u.total)/sampleDays):0;
    const morning=sampleDays?round3(Math.max(0,u.morning)/sampleDays):0;
    const afternoon=sampleDays?round3(Math.max(0,u.afternoon)/sampleDays):0;
    const status=stock<=0?"CRITICAL" as const:b.minimum!=null&&stock<Number(b.minimum)?"WATCH" as const:"OK" as const;
    return {variantExternalId:b.id,itemName:b.name,unitLabel:b.unit,displayUnit:b.unit,
      displayFactor:1,soldByWeight:b.unit!=="pz",inStock:stock,avgDailyUsage14,
      expectedTodayMorning:morning,expectedTodayAfternoon:afternoon,
      expectedTomorrow:avgDailyUsage14,expectedTomorrowMorning:morning,
      expectedTomorrowAfternoon:afternoon,purchaseCost:null as number|null,status};
  });
  const orderById=new Map(paidOrders.map(o=>[o.id,o]));
  const popular=new Map<string,number>(),today=dateKey(now);
  let todaySoldUnits=0;
  for(const l of lines){
    if(l.category!=="CALIENTES"&&l.category!=="FRÍAS")continue;
    const n=Number(l.quantity);
    popular.set(l.name,(popular.get(l.name)??0)+n);
    const paidAt=orderById.get(l.orderId)?.paidAt;
    if(paidAt&&dateKey(paidAt)===today)todaySoldUnits+=n;
  }
  const topProducts=sampleDays?[...popular].map(([name,n])=>({name,expected:n/sampleDays}))
    .sort((a,b)=>b.expected-a.expected).slice(0,10):[];
  const trafficByHour=Array.from({length:24},(_,hour)=>({hour,tickets:0,sales:0}));
  if(sampleDays)for(const o of paidOrders){
    if(!o.paidAt)continue;
    const t=trafficByHour[hourKey(o.paidAt)];
    t.tickets+=1/sampleDays;t.sales+=Number(o.total)/sampleDays;
  }
  const currentHour=hourKey(now);
  const upcoming=trafficByHour.filter(t=>t.hour>=currentHour&&t.hour<=22&&t.tickets>0)
    .sort((a,b)=>b.tickets-a.tickets||b.sales-a.sales);
  return {smartRows,todaySoldUnits,sampleDays,shift:{
    current:currentHour<16?"MORNING" as const:"AFTERNOON" as const,
    sampleDays,risks:[] as Array<{itemName:string;status:"ACTION"|"WATCH";unitLabel:string;expectedShift:number}>,
    traffic:{currentHour:sampleDays?trafficByHour[currentHour]:null,
      nextPeak:upcoming.find(t=>t.hour<=currentHour+3)??null,dayPeak:upcoming[0]??null},
    topProducts},unavailableProducts:[] as Array<{itemName:string;blockers:string[]}>};
}
