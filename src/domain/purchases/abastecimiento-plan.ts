/** Planificador de abastecimiento en modo solo lectura; ninguna operación escribe inventario. */
export type SupplyKind = "PERECEDERO"|"ESTABLE"|"CAFE_VERDE";
export type BuyMode = "AUTO"|"SUELTO"|"CAJA";
export type InventorySeed = {
  id:string; name:string;unit:"g"|"ml"|"pz";stock:number|null;
  daily:number|null; minimum:number|null; severity?:string;
};
export type SupplyLine = InventorySeed & {
  chosen:boolean; kind:SupplyKind; supplier:string; manualQty:string;
  unitPrice:string; boxUnits:string; boxPrice:string; shelfDays:string;
  inTransit:string; buyMode:BuyMode;
};
export type SupplyDecision = {
  line:SupplyLine; required:number|null; mode:"SUELTO"|"CAJA";
  units:number; boxes:number; estimatedCost:number|null;
  effectiveUnitCost:number|null; retailCost:number|null;
  status:"NO_DATOS"|"NO_PRECIO"|"NO_NECESARIO"|"CON_PRESUPUESTO"|"PARCIAL"|"SIN_PRESUPUESTO"|"PENDIENTE_PRESUPUESTO";
  note:string; urgency:number;
};
export type PlanResult = {
  decisions:SupplyDecision[]; estimatedSpend:number; unfunded:number;
  missingPrices:number; missingForecasts:number; assigned:number;
  unknownBudget:boolean; availableAfterReserve:number|null;
  remainingCash:number|null; boxUpgrades:number; plannedUnits:number;
};
export function nonnegative(value:string):number|null {
  if(value.trim()==="") return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
}
export function whole(value:number):number { return Math.ceil(Math.max(0,value)-0.00000001); }
function requiredQty(line:SupplyLine, untilTrip:number, cycleDays:number):number|null {
  const manual=nonnegative(line.manualQty);
  if(manual!==null)return whole(manual);
  const daily=line.daily,stock=line.stock,minimum=line.minimum??0;
  if(daily===null||stock===null) {
    return stock!==null&&line.minimum!==null&&stock<minimum?whole(minimum-stock):null;
  }
  const horizon=line.kind==="PERECEDERO"
    ?Math.min(cycleDays,nonnegative(line.shelfDays)??cycleDays):cycleDays;
  const inTransit=nonnegative(line.inTransit)??0;
  // Inventario proyectado al día de salida y meta para cubrir hasta la siguiente salida.
  const onArrival=stock-daily*untilTrip+inTransit;
  return whole(daily*Math.max(0,horizon)+minimum-onArrival);
}
function urgency(line:SupplyLine,untilTrip:number){
  if(line.stock===null)return 4;
  if(line.stock<=0)return 0;
  if(line.daily!==null&&line.daily>0&&line.stock/line.daily<=untilTrip+1)return 0;
  if(line.minimum!==null&&line.stock<=line.minimum)return 1;
  if(line.kind==="PERECEDERO")return 2;
  return 3;
}
/** Las cajas NO se priorizan sobre las necesidades básicas de la semana. */
export function calculateSupplyPlan(
  lines:SupplyLine[],cashText:string,reserveText:string,
  tripCost:number|null,untilTrip:number,cycleDays=7,
):PlanResult {
  const cash=nonnegative(cashText),reserve=nonnegative(reserveText)??0;
  const available=cash===null||tripCost===null?null:Math.max(0,cash-reserve-tripCost);
  let remaining=available;
  let missingPrices=0,missingForecasts=0,unfunded=0,assigned=0,boxUpgrades=0;
  const selected=lines.filter(l=>l.chosen).sort((a,b)=>urgency(a,untilTrip)-urgency(b,untilTrip)||a.name.localeCompare(b.name,"es"));
  const decisions:SupplyDecision[]=selected.map(line=>{
    const required=requiredQty(line,untilTrip,cycleDays);
    const loose=nonnegative(line.unitPrice);
    const boxQty=nonnegative(line.boxUnits),boxPrice=nonnegative(line.boxPrice);
    const boxCount=required!==null&&required>0&&boxQty!==null&&boxQty>0?whole(required/boxQty):0;
    const retailCost=required===null||loose===null?null:required*loose;
    const validBox=boxCount>0&&boxPrice!==null&&boxQty!==null&&boxQty>0;
    const boxCost=validBox?boxCount*boxPrice!:null;
    const noWaste=line.kind!=="PERECEDERO" || (boxQty!==null&&required!==null&&
      boxCount*boxQty<=required+0.000001);
    const boxCheaper=validBox&&loose!==null&&boxCost!==null&&
      boxCost<retailCost! && boxPrice!/boxQty!<loose && noWaste;
    const chooseBox=line.buyMode==="CAJA"&&validBox||
      line.buyMode==="AUTO"&&boxCheaper;
    const units=required??0;
    const plannedUnits=chooseBox?boxCount*(boxQty??0):units;
    const cost=chooseBox?boxCost:retailCost;
    const note=chooseBox&&line.kind==="PERECEDERO"&&!noWaste
      ?"Caja puede exceder el consumo antes de caducar."
      :chooseBox?"Compra por caja con presentación registrada.":"Compra fraccionada para cuidar liquidez.";
    return {line,required,mode:chooseBox?"CAJA" as const:"SUELTO" as const,
      units:plannedUnits,boxes:chooseBox?boxCount:0,estimatedCost:cost,
      effectiveUnitCost:cost!==null&&plannedUnits>0?cost/plannedUnits:null,
      retailCost,
      status:required===null?"NO_DATOS" as const:required===0?"NO_NECESARIO" as const:
        cost===null?"NO_PRECIO" as const:"PENDIENTE_PRESUPUESTO" as const,
      note,urgency:urgency(line,untilTrip)};
  });
  // No comprometer efectivo en compras posponibles cuando falta cotizar
  // pan, leche u otro insumo prioritario: el gasto básico está incompleto.
  const essentialUnpriced=decisions.some(d=>d.urgency<=2&&
    (d.status==="NO_DATOS"||d.status==="NO_PRECIO"));
  // Primera pasada: abastecimiento viable. Si falta dinero para una caja,
  // ofrecer compra suelta parcial cuando el precio está confirmado.
  for(const d of decisions){
    if(d.status==="NO_DATOS"){missingForecasts++;continue}
    if(d.status==="NO_PRECIO"){missingPrices++;continue}
    if(d.status==="NO_NECESARIO")continue;
    if(essentialUnpriced&&d.urgency>2){
      d.status="PENDIENTE_PRESUPUESTO";
      d.note="No asignar efectivo a esta compra hasta cotizar necesidades esenciales.";
      continue;
    }
    if(remaining===null)continue;
    const needCost=d.estimatedCost!;
    if(needCost<=remaining+0.000001) {
      d.status="CON_PRESUPUESTO";remaining=Math.max(0,remaining-needCost);assigned++;
      continue;
    }
    const loose=nonnegative(d.line.unitPrice);
    const affordable=loose!==null&&loose>0?whole(Math.floor((remaining+0.00000001)/loose)):0;
    if(affordable>0&&d.required!==null){
      const take=Math.min(d.required,affordable);
      d.mode="SUELTO";d.boxes=0;d.units=take;d.estimatedCost=take*loose!;
      d.effectiveUnitCost=loose;d.status=take<d.required?"PARCIAL":"CON_PRESUPUESTO";
      d.note=take<d.required?"Solo compra parcial: quedan unidades sin financiar.":
        "Compra suelta para no inmovilizar efectivo en una caja.";
      remaining=Math.max(0,remaining-d.estimatedCost);
      if(take<d.required)unfunded++;else assigned++;
    }else{
      d.status="SIN_PRESUPUESTO";d.units=0;d.boxes=0;d.estimatedCost=0;
      d.note="Pendiente por falta de presupuesto; no se registrará como comprado.";
      unfunded++;
    }
  }
  // Las oportunidades de caja sólo usan el efectivo sobrante DESPUÉS de lo indispensable.
  if(remaining!==null){
    for(const d of decisions){
      if(d.status!=="CON_PRESUPUESTO"||d.line.buyMode!=="AUTO"||d.mode==="CAJA"||
        d.required===null||d.required===0)continue;
      const boxQty=nonnegative(d.line.boxUnits),boxPrice=nonnegative(d.line.boxPrice),
        unit=nonnegative(d.line.unitPrice);
      if(boxQty===null||boxQty===0||boxPrice===null||unit===null||unit===0)continue;
      const boxes=whole(d.required/boxQty),quantity=boxes*boxQty,boxTotal=boxes*boxPrice;
      const current=d.estimatedCost??0,increment=boxTotal-current;
      // Caja debe ahorrar por unidad, usarse dentro de una cobertura razonable,
      // y consumir como máximo el 35 % del presupuesto originalmente disponible en EXTRA.
      const projected=d.line.daily!==null&&d.line.daily>0?quantity/d.line.daily:Infinity;
      const storageLimit=d.line.kind==="PERECEDERO"
        ?Math.min(cycleDays,nonnegative(d.line.shelfDays)??cycleDays)
        :Math.max(cycleDays*4,28);
      if(boxPrice/boxQty>=unit||increment<=0||increment>remaining||
        (available!==null&&increment>available*.35)||
        projected>storageLimit)continue;
      d.mode="CAJA";d.boxes=boxes;d.units=quantity;d.estimatedCost=boxTotal;
      d.effectiveUnitCost=boxPrice/boxQty;d.note="Caja viable después de financiar las necesidades prioritarias.";
      remaining-=increment;boxUpgrades++;
    }
  }
  const estimatedSpend=decisions.reduce((total,d)=>total+(
    d.status==="CON_PRESUPUESTO"||d.status==="PARCIAL"?d.estimatedCost??0:0),0);
  return {decisions,estimatedSpend,unfunded,missingPrices,missingForecasts,assigned,
    unknownBudget:available===null,availableAfterReserve:available,remainingCash:remaining,
    boxUpgrades,plannedUnits:decisions.reduce((a,d)=>a+(d.status==="CON_PRESUPUESTO"||
    d.status==="PARCIAL"?d.units:0),0)};
}
