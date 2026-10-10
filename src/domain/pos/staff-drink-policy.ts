/**
 * Política de consumo de personal de Café Épico.
 * Reglas confirmadas: una bebida incluida por jornada y 10% en bebidas adicionales.
 * Este módulo solo cotiza: la autorización, elegibilidad, consumo por jornada y
 * movimiento de inventario deben ejecutarse de forma atómica en checkout LIVE.
 */
export type StaffBenefitKind="NONE"|"INCLUDED_DRINK"|"ADDITIONAL_10";
export type StaffBeverage={
  category:"CALIENTES"|"FRÍAS"|"ALIMENTOS";
  basePrice:number;extrasPrice:number;ownThermos:boolean;
};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function calculateStaffDrinkBenefit(
  lines:StaffBeverage[],kind:StaffBenefitKind,
):{discount:number;warnings:string[];benefitLabel:string}{
  if(kind==="NONE")return {discount:0,warnings:[],benefitLabel:"Sin consumo de personal"};
  const warnings:string[]=[];
  if(lines.length!==1)warnings.push("El consumo de personal se registra en un ticket de una sola bebida.");
  const line=lines[0];
  if(!line||line.category==="ALIMENTOS")
    warnings.push("El beneficio de Azucena solo corresponde a una bebida.");
  if(line?.ownThermos)
    warnings.push("No combinar beneficio de personal con termo propio.");
  if(line&&(!Number.isFinite(line.basePrice)||line.basePrice<=0||
    !Number.isFinite(line.extrasPrice)||line.extrasPrice<0))
    warnings.push("Precio de bebida o extras inválido.");
  const discount=warnings.length?0:round(kind==="INCLUDED_DRINK"?
    line.basePrice:line.basePrice*.1);
  return {discount,warnings,benefitLabel:kind==="INCLUDED_DRINK"?
    "Azucena · 1 bebida incluida por jornada":"Azucena · 10% en bebida adicional"};
}
