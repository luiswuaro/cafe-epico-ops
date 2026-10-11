import {and,eq} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {inventoryBalances,inventoryItems,inventoryLocations,loyverseInventoryMappings} from "@/src/infrastructure/db/schema";

export type NativeRecipeOption={
  inventoryItemId:string; locationId:string; locationName:string; name:string;
  unit:"g"|"ml"|"pz"; trackingType:string; available:number;
};
export type LegacyRecipeMapping={
  variantExternalId:string; inventoryItemId:string;locationId:string;factor:number;
};
/** Existing stock is the source of truth; external variants only help convert old recipes. */
export async function getNativeRecipeOptions(organizationId:string,storeId:string){
  const db=getDb();
  const [stock,locations,items,oldMappings]=await Promise.all([
    db.select({
      inventoryItemId:inventoryBalances.inventoryItemId,
      locationId:inventoryBalances.locationId,
      quantity:inventoryBalances.theoreticalQuantity,
    }).from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,organizationId),
      eq(inventoryBalances.storeId,storeId),
    )),
    db.select().from(inventoryLocations).where(and(
      eq(inventoryLocations.organizationId,organizationId),
      eq(inventoryLocations.storeId,storeId),eq(inventoryLocations.isActive,true),
    )),
    db.select().from(inventoryItems).where(and(
      eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.isActive,true),
    )),
    db.select({
      variantExternalId:loyverseInventoryMappings.loyverseVariantExternalId,
      inventoryItemId:loyverseInventoryMappings.inventoryItemId,
      locationId:loyverseInventoryMappings.locationId,
      factor:loyverseInventoryMappings.factorToCanonical,
    }).from(loyverseInventoryMappings).where(and(
      eq(loyverseInventoryMappings.organizationId,organizationId),
      eq(loyverseInventoryMappings.storeId,storeId),
      eq(loyverseInventoryMappings.isActive,true),
    )),
  ]);
  const enabledLocations=new Map(locations.map(x=>[x.id,x.name]));
  // Solo insumos con existencias. Agua e hielo se ofrecen como componentes
  // virtuales COST_ONLY en el editor, sin saldos ni equivalencias.
  const availableItems=new Map(items.filter(i=>i.category!=="INSUMO_QA"&&
    i.trackingType==="QUANTITY").map(i=>[i.id,i]));
  const options:NativeRecipeOption[]=stock.flatMap(s=>{
    const i=availableItems.get(s.inventoryItemId);
    if(!i||!enabledLocations.has(s.locationId))return [];
    return [{inventoryItemId:i.id,locationId:s.locationId,locationName:enabledLocations.get(s.locationId)??"",name:i.name,
      unit:i.canonicalUnit,trackingType:i.trackingType,available:Number(s.quantity)}];
  });
  options.sort((a,b)=>a.name.localeCompare(b.name,"es")||a.locationId.localeCompare(b.locationId));
  const legacyMappings:LegacyRecipeMapping[]=oldMappings.map(m=>({
    variantExternalId:m.variantExternalId,
    inventoryItemId:m.inventoryItemId,locationId:m.locationId,factor:Number(m.factor),
  }));
  return {options,legacyMappings,locations};
}
