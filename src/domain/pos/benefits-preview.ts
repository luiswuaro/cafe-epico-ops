/**
 * Reglas deterministas para simular beneficios operativos.
 * Sin escrituras: cobrar LIVE exige validación de permisos,
 * elegibilidad y contabilidad transaccional independiente.
 */
export type BenefitKind = "NONE"|"STAFF_FREE"|"STAFF_10"|"POINTS"|"MANUAL_FIXED"|"MANUAL_PERCENT";
export type Scope = "LINE"|"TICKET";
export type BenefitLine = {id:string;name:string;category:"CALIENTES"|"FRÍAS"|"ALIMENTOS";basePrice:number;extras:number;ownThermos:boolean};
export type BenefitRequest = {
  kind:BenefitKind;scope:Scope;lineId:string;
  value:number;reason:string;
  availablePoints:number;mxnPerPoint:number;
  staffFreeAlreadyUsed:boolean;
};
export type BenefitResult = {
  subtotal:number;thermosSavings:number;ordinaryDiscount:number;
  redeemedPoints:number;redeemedValue:number;due:number;
  earnablePoints:number;warnings:string[];valid:boolean;
  perLine:Array<{id:string;name:string;listPrice:number;thermosDiscount:number;benefitDiscount:number;amount:number}>;
};
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const finite=(v:number)=>Number.isFinite(v)&&v>=0;
export function calculateBenefitPreview(lines:BenefitLine[],request:BenefitRequest):BenefitResult {
  const warnings:string[]=[];
  const mapped=lines.map(line=>{
    if(!finite(line.basePrice)||!finite(line.extras)||line.basePrice<=0)
      warnings.push("Los precios deben ser positivos y los extras no negativos.");
    if(line.ownThermos && line.category==="ALIMENTOS")warnings.push("Termo propio solo corresponde a bebidas.");
    const listPrice=round(line.basePrice+line.extras);
    const thermosDiscount=line.ownThermos&&line.category!=="ALIMENTOS"?Math.min(5,line.basePrice):0;
    return {id:line.id,name:line.name,listPrice,thermosDiscount,benefitDiscount:0,amount:round(listPrice-thermosDiscount)};
  });
  const subtotal=round(mapped.reduce((n,l)=>n+l.listPrice,0));
  const thermosSavings=round(mapped.reduce((n,l)=>n+l.thermosDiscount,0));
  const currentTotal=round(subtotal-thermosSavings);
  const target=request.scope==="TICKET"?mapped:mapped.filter(x=>x.id===request.lineId);
  if(request.kind!=="NONE"&&target.length===0)warnings.push("Selecciona un producto para el beneficio.");
  if(request.kind!=="NONE" && !finite(request.value))warnings.push("El importe de beneficio no es válido.");
  if(request.kind==="STAFF_FREE"){
    if(request.scope!=="LINE")warnings.push("La cortesía de personal se asigna a una sola bebida.");
    if(request.staffFreeAlreadyUsed)warnings.push("La cortesía del turno ya fue utilizada.");
    const selected=lines.find(x=>x.id===request.lineId);
    if(!selected||selected.category==="ALIMENTOS")warnings.push("La cortesía debe aplicarse a una bebida.");
    if(selected?.ownThermos)warnings.push("Revisa combinación de cortesía con termo: requiere regla autorizada.");
    if(!warnings.length && target.length===1){
      // Solo el precio base de una bebida; extras se cobran.
      const index=lines.findIndex(l=>l.id===request.lineId);
      target[0].benefitDiscount=round(Math.min(lines[index].basePrice,target[0].amount));
    }
  } else if(request.kind==="STAFF_10"){
    if(request.scope!=="LINE")warnings.push("10% de personal se asigna a una bebida por vez.");
    const selected=lines.find(x=>x.id===request.lineId);
    if(!selected||selected.category==="ALIMENTOS")warnings.push("El descuento de personal corresponde a bebidas.");
    if(selected?.ownThermos)warnings.push("No está aprobada la acumulación de termo y descuento de personal.");
    if(!warnings.length&&target.length===1){
      const selectedBase=selected!.basePrice;
      target[0].benefitDiscount=round(Math.min(target[0].amount,round(selectedBase*.1)));
    }
  } else if(request.kind==="MANUAL_FIXED" || request.kind==="MANUAL_PERCENT"){
    if(!request.reason.trim())warnings.push("Los descuentos manuales requieren motivo y autorización.");
    if(request.kind==="MANUAL_PERCENT"&&request.value>100)warnings.push("El porcentaje no puede superar 100%.");
    if(request.scope==="TICKET"&&mapped.some(x=>x.thermosDiscount>0))
      warnings.push("La acumulación de descuento de cuenta con termo requiere autorización de regla.");
    if(!warnings.length){
      const totalTarget=round(target.reduce((n,l)=>n+l.amount,0));
      const amount=request.kind==="MANUAL_FIXED"?request.value:round(totalTarget*request.value/100);
      if(amount>totalTarget)warnings.push("El descuento supera el importe elegible.");
      else if(target.length){
        // Repartir proporcionalmente por línea y ajustar centavos en última línea.
        let distributed=0;
        target.forEach((line,i)=>{
          const discount=i===target.length-1?round(amount-distributed):
            round(amount*(line.amount/totalTarget));
          line.benefitDiscount=discount;
          distributed=round(distributed+discount);
        });
      }
    }
  } else if(request.kind==="POINTS"){
    if(!finite(request.availablePoints)||!finite(request.mxnPerPoint)||request.mxnPerPoint<=0)
      warnings.push("Falta confirmar el valor monetario de cada punto.");
    if(request.value>request.availablePoints)warnings.push("El cliente no tiene suficientes puntos.");
    const availableTarget=round(target.reduce((n,l)=>n+l.amount,0));
    if(request.mxnPerPoint>0 && round(request.value*request.mxnPerPoint)>availableTarget)
      warnings.push("El canje supera el importe del producto o cuenta.");
  }
  const ordinaryDiscount=round(mapped.reduce((n,l)=>n+l.benefitDiscount,0));
  const redeemedPoints=request.kind==="POINTS"&&!warnings.length?round(request.value):0;
  const redeemedValue=round(redeemedPoints*request.mxnPerPoint);
  const due=round(Math.max(0,currentTotal-ordinaryDiscount-redeemedValue));
  const earnablePoints=round(due*.05);
  return {subtotal,thermosSavings,ordinaryDiscount,redeemedPoints,redeemedValue,due,
    earnablePoints,warnings,valid:warnings.length===0,perLine:mapped};
}
