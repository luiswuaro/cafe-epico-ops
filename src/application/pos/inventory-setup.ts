import { and, eq } from "drizzle-orm";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryItems, inventoryBalances, inventoryLocations, loyverseInventoryLevels, loyverseInventoryMappings,
  loyverseItems, loyverseStores, loyverseVariants,
} from "@/src/infrastructure/db/schema";

export async function getPosInventorySetup(organizationId:string,storeId:string) {
  const db=getDb();
  const [catalog,items,variants,levels,mappings,locations,stores,internalItems,internalBalances]=await Promise.all([
    getPosCatalog(organizationId),
    db.select().from(loyverseItems).where(eq(loyverseItems.organizationId,organizationId)),
    db.select().from(loyverseVariants).where(eq(loyverseVariants.organizationId,organizationId)),
    db.select().from(loyverseInventoryLevels).where(eq(loyverseInventoryLevels.organizationId,organizationId)),
    db.select().from(loyverseInventoryMappings).where(and(
      eq(loyverseInventoryMappings.organizationId,organizationId),
      eq(loyverseInventoryMappings.storeId,storeId),
      eq(loyverseInventoryMappings.isActive,true),
    )),
    db.select().from(inventoryLocations).where(and(
      eq(inventoryLocations.organizationId,organizationId),
      eq(inventoryLocations.storeId,storeId),
      eq(inventoryLocations.isActive,true),
    )),
    db.select().from(loyverseStores).where(eq(loyverseStores.organizationId,organizationId)),
    db.select().from(inventoryItems).where(and(eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.isActive,true))),
    db.select().from(inventoryBalances).where(and(eq(inventoryBalances.organizationId,organizationId),eq(inventoryBalances.storeId,storeId))),
  ]);
  const sourceStore=stores.length===1 ? stores[0]?.externalId : null;
  const requested=new Map<string,{id:string;name:string;uses:number;units:Set<string>}>();
  let unsupported=0;
  for(const product of catalog) for(const mode of ["DINE_IN","TAKEAWAY"] as const){
    for(const component of product.serviceRecipes[mode].components){
      if(!component.variantExternalId){unsupported++;continue;}
      const prev=requested.get(component.variantExternalId);
      if(prev){prev.uses++;prev.units.add(component.unitLabel);}
      else requested.set(component.variantExternalId,{id:component.variantExternalId,
        name:component.name,uses:1,units:new Set([component.unitLabel])});
    }
  }
  const itemById=new Map(items.map(i=>[i.externalId,i]));
  const variantById=new Map(variants.map(v=>[v.externalId,v]));
  const stockByVariant=new Map(levels.filter(l=>l.storeExternalId===sourceStore).map(l=>[l.variantExternalId,l]));
  const mapped=new Set(mappings.map(m=>m.loyverseVariantExternalId));
  const candidates=[...requested.values()].map(component=>{
    const variant=variantById.get(component.id);
    const sourceItem=variant?.loyverseItemExternalId ? itemById.get(variant.loyverseItemExternalId):null;
    const weighted=sourceItem?.payload.sold_by_weight===true;
    // Política confirmada para la barra: sólo la leche deslactosada se mide
    // en litros/mililitros; los demás ingredientes fraccionarios se pesan.
    const officialUnit: "g" | "ml" | "pz" = !weighted ? "pz" :
      (sourceItem?.itemName.trim().toUpperCase()==="LECHE DESLACTOSADA" ? "ml" : "g");
    const sourceQty=stockByVariant.get(component.id)?.inStock;
    return {
      id:component.id,
      name:sourceItem?.itemName||component.name,
      recipeAppearances:component.uses,
      weighted,
      officialUnit,
      mapped:mapped.has(component.id),
      sourceAvailable:Boolean(sourceItem&&variant),
      sourceQuantity:sourceQty==null?null:Number(sourceQty),
      suggested:sourceQty==null?null:Math.round(Number(sourceQty)*(weighted?1000:1)*1000)/1000,
      unit:officialUnit,
    };
  }).sort((a,b)=>Number(a.mapped)-Number(b.mapped)||b.recipeAppearances-a.recipeAppearances||a.name.localeCompare(b.name,"es"));
  const inUse=new Set(internalBalances.map(b=>b.inventoryItemId));
  const alreadyLinked=new Set(mappings.map(m=>m.inventoryItemId));
  const reusableItems=internalItems.filter(item=>!inUse.has(item.id)&&!alreadyLinked.has(item.id))
    .map(item=>({id:item.id,name:item.name,unit:item.canonicalUnit}));
  return {candidates,locations,sourceStore,unsupported,products:catalog.length,alreadyMapped:mappings.length,reusableItems};
}
