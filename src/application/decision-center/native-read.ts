import {and,desc,eq,isNull,gte} from "drizzle-orm";
import {getBusinessAnalytics} from "@/src/application/analytics/ops";
import {getNativePurchases} from "@/src/application/purchases/native";
import {getDb} from "@/src/infrastructure/db/client";
import {operationalEvents,roastBatches} from "@/src/infrastructure/db/schema";

type Decision={level:"ACTION"|"WATCH"|"INFO";area:string;title:string;detail:string;href:string};
const order:{[K in Decision["level"]]:number}={ACTION:0,WATCH:1,INFO:2};
export async function getNativeDecisionCenter(organizationId:string){
  const db=getDb();
  // OPS es fuente única. No llamar jamás analytics/business.ts ni
  // loyverse/inventory-intelligence.ts ni usar recibos históricos para reportar ventas.
  const [analytics,purchasing,events,batches]=await Promise.all([
    getBusinessAnalytics(organizationId),
    getNativePurchases(organizationId),
    db.select({id:operationalEvents.id,eventType:operationalEvents.eventType,
      severity:operationalEvents.severity,itemName:operationalEvents.itemNameSnapshot,
      note:operationalEvents.note,occurredAt:operationalEvents.occurredAt})
      .from(operationalEvents).where(and(eq(operationalEvents.organizationId,organizationId),
        isNull(operationalEvents.resolvedAt)))
      .orderBy(desc(operationalEvents.occurredAt)).limit(12),
    db.select({green:roastBatches.greenWeightG,roasted:roastBatches.roastedWeightG,
      date:roastBatches.roastedAt})
      .from(roastBatches).where(and(eq(roastBatches.organizationId,organizationId),
        gte(roastBatches.roastedAt,new Date(Date.now()-30*86_400_000)))),
  ]);
  const today=analytics.periods.find(p=>p.key==="today")!;
  const week=analytics.periods.find(p=>p.key==="7d")!;
  const month=analytics.periods.find(p=>p.key==="30d")!;
  const decisions:Decision[]=[];
  const low=purchasing.suggested;
  const critical=low.filter(x=>x.stock<=0);
  const unsetMinimum=purchasing.rows.filter(x=>x.minimum==null);
  const unpriced=purchasing.rows.filter(x=>x.unitCost==null);
  if(critical.length)decisions.push({level:"ACTION",area:"INVENTARIO",
    title:critical.length+" insumo(s) sin existencia para reponer",
    detail:critical.slice(0,3).map(x=>x.name).join(" · "),
    href:"/admin/purchases"});
  if(low.length)decisions.push({level:"WATCH",area:"COMPRAS",
    title:low.length+" reposiciones sugeridas desde OPS",
    detail:"Presupuesto parcial: "+low.reduce((n,x)=>n+(x.suggestion?.estimatedCost??0),0)
      .toLocaleString("es-MX",{style:"currency",currency:"MXN"})+
      ". Precios faltantes: "+low.filter(x=>x.suggestion?.estimatedCost==null).length+".",
    href:"/admin/purchases"});
  if(unsetMinimum.length)decisions.push({level:"WATCH",area:"DATOS",
    title:unsetMinimum.length+" insumo(s) sin mínimo de inventario",
    detail:"Configurar umbrales en g, ml o piezas para evitar recomendaciones arbitrarias.",
    href:"/admin/purchases"});
  if(unpriced.length)decisions.push({level:"ACTION",area:"FINANZAS",
    title:unpriced.length+" insumo(s) sin costo nativo",
    detail:"El margen no puede considerarse completo hasta registrar los costos faltantes.",
    href:"/admin/purchases"});
  if(!month.cogsComplete&&month.tickets>0)decisions.push({level:"ACTION",area:"MÁRGENES",
    title:"COGS del periodo incompleto",
    detail:"Cobertura de tickets con costo íntegro: "+
      month.costCoveragePct.toFixed(1)+"%. No presentar utilidad como definitiva.",
    href:"/admin/analytics"});
  if(week.salesChangePct!==null&&week.salesChangePct<=-8)decisions.push({
    level:"WATCH",area:"VENTAS",title:"Caída semanal de ventas OPS",
    detail:week.salesChangePct.toFixed(1)+"% respecto a los siete días anteriores.",
    href:"/admin/analytics"});
  if(month.tickets>=10&&month.captureRate<45)decisions.push({
    level:"INFO",area:"CLIENTES",title:"Mejorar identificación en ventas",
    detail:month.captureRate.toFixed(1)+"% de tickets con cliente vinculado.",
    href:"/pos"});
  if(events.length)decisions.push({level:"WATCH",area:"OPERACIÓN",
    title:events.length+" incidencia(s) abiertas (máximo 12 visibles)",
    detail:events[0].note??events[0].eventType,
    href:"/admin/operations/events"});
  const lossRates=batches.filter(b=>Number(b.green)>0&&b.roasted!=null)
    .map(b=>(Number(b.green)-Number(b.roasted))/Number(b.green)*100);
  const roastLoss=lossRates.length?
    lossRates.reduce((n,x)=>n+x,0)/lossRates.length:null;
  const costedProducts=analytics.topProducts.filter(p=>p.cogsComplete);
  const popularMedian=costedProducts.length?
    [...costedProducts.map(p=>p.qty)].sort((a,b)=>a-b)[Math.floor(costedProducts.length/2)]:null;
  const marginMedian=costedProducts.length?
    [...costedProducts.map(p=>p.contributionPct)].sort((a,b)=>a-b)[Math.floor(costedProducts.length/2)]:null;
  return {
    source:"OPS_LIVE" as const,asOf:analytics.asOf,
    today,week,month,analytics,
    purchases:purchasing,unpricedCount:unpriced.length,unsetMinimumCount:unsetMinimum.length,
    events,batches30:batches.length,roastLoss30:roastLoss,
    decisions:decisions.sort((a,b)=>order[a.level]-order[b.level]).slice(0,12),
    products:analytics.topProducts.map(p=>({
      ...p,quadrant:p.cogsComplete&&popularMedian!=null&&marginMedian!=null
        ?p.qty>=popularMedian?(p.contributionPct>=marginMedian?"ESTRELLA":"VOLUMEN"):
          (p.contributionPct>=marginMedian?"OPORTUNIDAD":"REVISAR")
        :"COSTO PENDIENTE",
    })),
  };
}
