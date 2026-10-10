/**
 * Agrupa los consumos de todas las cuentas del mismo folio antes de revertir.
 * El índice único de inventario sólo admite una reversa por folio/insumo/ubicación.
 */
export type AppliedSaleMovement={
  locationId:string;
  inventoryItemId:string;
  quantityDelta:string|number;
};

export function planInventoryReversals(movements:ReadonlyArray<AppliedSaleMovement>){
  const grouped=new Map<string,{locationId:string;inventoryItemId:string;quantityDelta:number}>();
  for(const movement of movements){
    const delta=Number(movement.quantityDelta);
    if(!Number.isFinite(delta)||delta>=0){
      throw new Error("Movimiento de venta inválido para reversión.");
    }
    const key=movement.locationId+":"+movement.inventoryItemId;
    const current=grouped.get(key);
    if(current)current.quantityDelta+=delta;
    else grouped.set(key,{
      locationId:movement.locationId,
      inventoryItemId:movement.inventoryItemId,
      quantityDelta:delta,
    });
  }
  return Array.from(grouped.values(),movement=>{
    const returned=Math.round(-movement.quantityDelta*1000)/1000;
    if(!Number.isFinite(returned)||returned<=0)
      throw new Error("Cantidad de reversión inválida.");
    return {locationId:movement.locationId,inventoryItemId:movement.inventoryItemId,returned};
  });
}
