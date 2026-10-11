/**
 * Granularity: 0.001 g, matching inventory_movements and inventory_balances.
 * Batch receipts stay traceable; transfers are quantities from a shared bag,
 * NOT reclassifications of individual batches.
 */
export function grams(value:unknown):number {
  const raw=typeof value==="string"?value.trim():String(value??"");
  if(!raw || !/^\d+(?:\.\d{1,3})?$/.test(raw))
    throw new Error("Escribe gramos positivos con máximo 3 decimales.");
  const num=Number(raw);
  const milli=Math.round(num*1000);
  if(!Number.isSafeInteger(milli)||milli<=0||milli>10_000_000_000)
    throw new Error("La cantidad de gramos debe ser positiva y válida.");
  return milli/1000;
}
export function transferProjection(stockG:number,barG:number,requested:unknown){
  const qty=grams(requested);
  if(!Number.isFinite(stockG)||!Number.isFinite(barG)||stockG<0||barG<0)
    throw new Error("Los saldos de inventario son inválidos.");
  const source=Math.round(stockG*1000),dest=Math.round(barG*1000);
  const amount=Math.round(qty*1000);
  if(amount>source)throw new Error("No puedes trasladar más gramos de los disponibles en la bolsa.");
  return {quantityG:qty,bagAfterG:(source-amount)/1000,barAfterG:(dest+amount)/1000};
}
export function mxRoastDate(date:Date):string {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(date);
}
export function roastDayBounds(date:string):{start:Date;end:Date} {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Fecha de tueste inválida.");
  const start=new Date(date+"T06:00:00.000Z");
  if(Number.isNaN(start.getTime())||mxRoastDate(start)!==date)
    throw new Error("Fecha de tueste inválida.");
  return {start,end:new Date(start.getTime()+86_400_000)};
}
export function roastingItemSku(lotId:string):string {
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(lotId))
    throw new Error("Lote de tueste inválido.");
  return "ROAST-"+lotId.slice(0,8).toUpperCase();
}
