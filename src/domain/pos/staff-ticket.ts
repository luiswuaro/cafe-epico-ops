/** Cotización pura de beneficios por línea para el preview POS.
 * Una misma cuenta puede contener compras de cliente y consumos de varios
 * empleados. Los puntos del cliente jamás se calculan sobre líneas de personal.
 * Los descuentos de personal NO están habilitados en checkout LIVE.
 */
export type StaffBenefitKind="NONE"|"INCLUDED_DRINK"|"ADDITIONAL_10";
export type StaffBenefitLine={
  key:string;
  name:string;
  category:"CALIENTES"|"FRÍAS"|"ALIMENTOS";
  basePrice:number;
  extrasPrice:number;
  ownThermos:boolean;
  staffBenefit:StaffBenefitKind;
  employeeId:string|null;
};
export type StaffBenefitLineResult={
  key:string;name:string;employeeId:string|null;staffBenefit:StaffBenefitKind;
  listedAmount:number;thermosDiscount:number;staffDiscount:number;
  payable:number;customerEligibleAmount:number;
};
export type StaffBenefitTicketResult={
  listedTotal:number;thermosDiscount:number;staffDiscount:number;
  customerEligibleTotal:number;staffPayable:number;totalBeforePoints:number;
  perLine:StaffBenefitLineResult[];warnings:string[];valid:boolean;
};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;

export function calculateStaffTicket(lines:StaffBenefitLine[]):StaffBenefitTicketResult{
  const warnings:string[]=[];
  const freePerEmployee=new Set<string>();
  const perLine=lines.map((line,index):StaffBenefitLineResult=>{
    const label=`${index+1}. ${line.name}`;
    const staff=line.staffBenefit!=="NONE";
    if(!Number.isFinite(line.basePrice)||line.basePrice<=0||
       !Number.isFinite(line.extrasPrice)||line.extrasPrice<0)
      warnings.push(label+": precio o extras no válidos.");
    if(line.ownThermos&&line.category==="ALIMENTOS")
      warnings.push(label+": termo propio no corresponde a alimentos.");
    if(staff&&line.category==="ALIMENTOS")
      warnings.push(label+": beneficio de personal solo válido para bebidas.");
    if(staff&&!line.employeeId)
      warnings.push(label+": elige al empleado beneficiario.");
    if(staff&&line.ownThermos)
      warnings.push(label+": no combinar descuento de personal y termo en una bebida.");
    if(line.staffBenefit==="INCLUDED_DRINK"&&line.employeeId){
      if(freePerEmployee.has(line.employeeId))
        warnings.push(label+": ese trabajador ya tiene una bebida incluida en este ticket.");
      freePerEmployee.add(line.employeeId);
    }
    const listedAmount=round(line.basePrice+line.extrasPrice);
    const thermosDiscount=line.ownThermos&&line.category!=="ALIMENTOS"?
      Math.min(5,line.basePrice):0;
    const afterThermos=round(listedAmount-thermosDiscount);
    const staffDiscount=staff?round(Math.min(afterThermos,
      line.staffBenefit==="INCLUDED_DRINK"?line.basePrice:line.basePrice*0.1)):0;
    const payable=round(afterThermos-staffDiscount);
    return {key:line.key,name:line.name,employeeId:staff?line.employeeId:null,
      staffBenefit:line.staffBenefit,listedAmount,thermosDiscount,staffDiscount,
      payable,customerEligibleAmount:staff?0:payable};
  });
  const sum=(key:keyof Pick<StaffBenefitLineResult,
    "listedAmount"|"thermosDiscount"|"staffDiscount"|"payable"|"customerEligibleAmount">)=>
    round(perLine.reduce((amount,line)=>amount+line[key],0));
  const totalBeforePoints=sum("payable");
  const customerEligibleTotal=sum("customerEligibleAmount");
  return {listedTotal:sum("listedAmount"),
    thermosDiscount:sum("thermosDiscount"),staffDiscount:sum("staffDiscount"),
    customerEligibleTotal,
    staffPayable:round(totalBeforePoints-customerEligibleTotal),
    totalBeforePoints,perLine,warnings,valid:warnings.length===0};
}

/** Solo la parte monetaria de las líneas de cliente genera lealtad;
 * los cobros de consumos personales (aun con 10%) quedan fuera.
 */
export function calculateMixedTicketSettlement(ticket:StaffBenefitTicketResult,
  pointsToRedeem:number):{customerDue:number;staffDue:number;totalDue:number;earnedPoints:number}{
  if(!ticket.valid)throw new Error("Cotización inválida.");
  if(!Number.isFinite(pointsToRedeem)||pointsToRedeem<0||
    Math.abs(pointsToRedeem*100-Math.round(pointsToRedeem*100))>0.000001||
    pointsToRedeem>ticket.customerEligibleTotal)
    throw new Error("Los puntos sólo pueden cubrir productos del cliente.");
  const customerDue=round(ticket.customerEligibleTotal-pointsToRedeem);
  const staffDue=ticket.staffPayable;
  return {customerDue,staffDue,totalDue:round(customerDue+staffDue),
    earnedPoints:round(customerDue*0.05)};
}
