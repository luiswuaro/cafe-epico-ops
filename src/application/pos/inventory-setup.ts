import { and, eq } from "drizzle-orm";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { getDb } from "@/src/infrastructure/db/client";
import {
  inventoryLocations, loyverseInventoryLevels, loyverseInventoryMappings,
  loyverseItems, loyverseStores, loyverseVariants,
} from "@/src/infrastructure/db/schema";

export async function getPosInventorySetup(organizationId:string,storeId:string) {
  const db=getDb();
  const [catalog,items,variants,levels,mappings,locations,stores]=await Promise.all([
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
    const sourceQty=stockByVariant.get(component.id)?.inStock;
    return {
      id:component.id,
      name:sourceItem?.itemName||component.name,
      category:component.uses,
      weighted,
      mapped:mapped.has(component.id),
      sourceAvailable:Boolean(sourceItem&&variant),
      suggested:sourceQty==null?null:Math.round(Number(sourceQty)*(weighted?1000:1)*1000)/1000,
      unit:weighted?"g" as const:"pz" as const,
    };
  }).sort((a,b)=>Number(a.mapped)-Number(b.mapped)||b.category-a.category||a.name.localeCompare(b.name,"es"));
  return {candidates,locations,sourceStore,unsupported,products:catalog.length,alreadyMapped:mappings.length};
}
