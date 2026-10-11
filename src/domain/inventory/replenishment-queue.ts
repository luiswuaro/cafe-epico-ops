/** Cola de reabasto sin mínimos inventados; basada en recetas vigentes de OPS.
 * Mide la cobertura de una sola preparación repetida, no proyecta la demanda.
 */
export type StockForReplenishment={
 id:string;name:string;unit:"g"|"ml"|"pz";minimum:number|null;balance:number|null;
};
export type RecipeConsumption={
 inventoryItemId:string;product:string;quantity:number;unit:string;
};
export type ReplenishmentRow=StockForReplenishment&{
 severity:"SIN_CONTEO"|"AGOTADO"|"BAJO_MINIMO"|"POCAS_PORCIONES"|"OK";
 maxPortion:number;referenceProduct:string;theoreticalPortions:number|null;
 deficitToMinimum:number|null;
};
export function buildReplenishmentQueue(stocks:StockForReplenishment[],
  consumptions:RecipeConsumption[],fewPortions=5){
 const highest=new Map<string,RecipeConsumption>();
 for(const usage of consumptions){
   if(!Number.isFinite(usage.quantity)||usage.quantity<=0)continue;
   const stock=stocks.find(row=>row.id===usage.inventoryItemId);
   if(!stock||stock.unit!==usage.unit)continue;
   const former=highest.get(usage.inventoryItemId);
   if(!former||usage.quantity>former.quantity)highest.set(usage.inventoryItemId,usage);
 }
 const all=stocks.flatMap(item=>{
   const usage=highest.get(item.id);
   if(!usage)return []; // Only the active POS ingredients; avoid obsolete/green stock alarms.
   const balance=item.balance;
   const portions=balance===null?null:Math.max(0,Math.floor(Math.max(0,balance)/usage.quantity));
   const deficit=item.minimum===null||balance===null?null:Math.max(0,item.minimum-balance);
   const severity:ReplenishmentRow["severity"]=balance===null?"SIN_CONTEO":
     balance<=0?"AGOTADO":
     item.minimum!==null&&balance<item.minimum?"BAJO_MINIMO":
     portions!==null&&portions<=fewPortions?"POCAS_PORCIONES":"OK";
   return [{...item,severity,maxPortion:usage.quantity,
     referenceProduct:usage.product,theoreticalPortions:portions,
     deficitToMinimum:deficit}];
 });
 const rank={AGOTADO:0,SIN_CONTEO:1,BAJO_MINIMO:2,POCAS_PORCIONES:3,OK:4};
 all.sort((a,b)=>rank[a.severity]-rank[b.severity]||
   (a.theoreticalPortions??999999)-(b.theoreticalPortions??999999)||
   a.name.localeCompare(b.name,"es-MX"));
 return {alerts:all.filter(x=>x.severity!=="OK"),
   all,missingMinimum:all.filter(x=>x.minimum===null).length,
   uncounted:all.filter(x=>x.severity==="SIN_CONTEO").length,
   fewPortionsThreshold:fewPortions};
}
