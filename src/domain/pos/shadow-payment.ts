/**
 * Un pago ESPEJO es una simulación. Cumple las restricciones contables del
 * esquema de pagos sin generar movimientos de caja, cobros ni puntos reales.
 * Si el cobro en efectivo no proporciona importe recibido, se simula pago
 * exacto y cambio 0, ya que la pantalla de Comandas no solicita billetes.
 */
export type ShadowMonetaryMethod="CASH"|"CARD"|"TRANSFER";
export function shadowPaymentFields(
  method:ShadowMonetaryMethod,
  total:number,
  tenderedRaw?:string|null,
):{tenderedAmount:string|null;changeAmount:string|null}{
  if(!Number.isFinite(total)||total<=0||Math.abs(total*100-Math.round(total*100))>0.000001)
    throw new Error("Importe de simulación inválido.");
  if(method!=="CASH")return {tenderedAmount:null,changeAmount:null};
  const parsed=tenderedRaw?.trim()?Number(tenderedRaw):total;
  const cents=Math.round(parsed*100);
  const dueCents=Math.round(total*100);
  if(!Number.isFinite(parsed)||!Number.isSafeInteger(cents)||cents<dueCents||
    cents>100_000_000||Math.abs(parsed*100-cents)>0.000001)
    throw new Error("El importe simulado recibido debe cubrir el total con hasta dos decimales.");
  return {
    tenderedAmount:(cents/100).toFixed(2),
    changeAmount:((cents-dueCents)/100).toFixed(2),
  };
}
