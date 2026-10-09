import { and, eq } from "drizzle-orm";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import { isCostOnlyComponent } from "@/src/application/pos/component-policy";
import { getDb } from "@/src/infrastructure/db/client";
import { inventoryBalances, inventoryItems, loyverseInventoryMappings, posCashSessions } from "@/src/infrastructure/db/schema";

export async function getPosReadiness(organizationId:string,storeId:string) {
  const db=getDb();
  const [catalog,mappings,balances,openCash]=await Promise.all([
    getPosCatalog(organizationId),
    db.select({
      sourceVariant:loyverseInventoryMappings.loyverseVariantExternalId,
      inventoryItemId:loyverseInventoryMappings.inventoryItemId,
      locationId:loyverseInventoryMappings.locationId,
      factor:loyverseInventoryMappings.factorToCanonical,
      unit:inventoryItems.canonicalUnit,
    }).from(loyverseInventoryMappings)
      .innerJoin(inventoryItems,eq(inventoryItems.id,loyverseInventoryMappings.inventoryItemId))
      .where(and(eq(loyverseInventoryMappings.organizationId,organizationId),
        eq(loyverseInventoryMappings.storeId,storeId),
        eq(loyverseInventoryMappings.isActive,true),
        eq(inventoryItems.isActive,true))),
    db.select({
      locationId:inventoryBalances.locationId,
      inventoryItemId:inventoryBalances.inventoryItemId,
      theoreticalQuantity:inventoryBalances.theoreticalQuantity,
    }).from(inventoryBalances)
      .innerJoin(inventoryItems,eq(inventoryItems.id,inventoryBalances.inventoryItemId))
      .where(and(
        eq(inventoryBalances.organizationId,organizationId),
        eq(inventoryBalances.storeId,storeId),
        eq(inventoryItems.isActive,true),
        eq(inventoryItems.trackingType,"QUANTITY"),
      )),
    db.select({id:posCashSessions.id}).from(posCashSessions).where(and(
      eq(posCashSessions.organizationId,organizationId),
      eq(posCashSessions.storeId,storeId),
      eq(posCashSessions.status,"OPEN"),
    )).limit(1),
  ]);
  const byVariant=new Map<string,typeof mappings>();
  for(const mapping of mappings){
    const old=byVariant.get(mapping.sourceVariant)||[];
    old.push(mapping);
    byVariant.set(mapping.sourceVariant,old);
  }
  const stock=new Map(balances.map(b=>[b.locationId+":"+b.inventoryItemId,Number(b.theoreticalQuantity)]));
  const modes=["DINE_IN","TAKEAWAY"] as const satisfies readonly PosServiceMode[];
  const products=catalog.map(product=>{
    const recipes=modes.map(mode=>{
      const errors:string[]=[];
      const consumption=new Map<string,{name:string;required:number;unit:string}>();
      const components=product.serviceRecipes[mode].components;
      if(!components.length)errors.push("Falta configurar receta.");
      const names=components.map(x=>x.name.toUpperCase());
      if((product.category==="CALIENTES"||product.category==="FRÍAS") && mode==="TAKEAWAY"){
        if(!names.some(n=>/VASO/.test(n)))errors.push("Falta vaso para llevar.");
        if(!names.some(n=>/TAPA/.test(n)))errors.push("Falta tapa para llevar.");
      }
      if((product.category==="CALIENTES"||product.category==="FRÍAS") && mode==="DINE_IN"){
        if(names.some(n=>/VASO|TAPA|MANGA|FAJILLA|SERVILLETA/.test(n)))errors.push("Receta aquí contiene empaque para llevar.");
        if(product.category==="FRÍAS"&&!names.some(n=>/POPOTE|PAJILLA/.test(n)))errors.push("Falta popote para consumo aquí.");
      }
      for(const component of components){
        if(isCostOnlyComponent(component))continue;
        const mappingsFor=component.variantExternalId
          ? (byVariant.get(component.variantExternalId)||[]):[];
        if(mappingsFor.length!==1){
          errors.push((mappingsFor.length ? "Equivalencia duplicada: " : "Sin equivalencia: ")+component.name);
          continue;
        }
        const mapping=mappingsFor[0];
        const amount=Math.round(component.quantity*Number(mapping.factor)*1000)/1000;
        if(!Number.isFinite(amount)||amount<=0){
          errors.push("Cantidad/unidad inválida: "+component.name);continue;
        }
        const key=mapping.locationId+":"+mapping.inventoryItemId;
        const prev=consumption.get(key);
        consumption.set(key,{name:component.name,required:Math.round(((prev?.required||0)+amount)*1000)/1000,unit:mapping.unit});
      }
      for(const [key,needed] of consumption){
        const balance=stock.get(key);
        if(balance==null)errors.push("Sin saldo inicial: "+needed.name);
        else if(balance+0.000001<needed.required)errors.push(
          "Sin existencias: "+needed.name+" (requiere "+needed.required+" "+needed.unit+")");
      }
      return {mode,ready:errors.length===0,errors,trackedCount:consumption.size,
        costOnlyCount:components.filter(isCostOnlyComponent).length};
    });
    return {id:product.id,name:product.name,category:product.category,price:product.price,recipes};
  });
  const total=products.length*2;
  const ready=products.reduce((sum,p)=>sum+p.recipes.filter(r=>r.ready).length,0);
  return {products,total,ready,blocked:total-ready,cashOpen:openCash.length>0,mappings:mappings.length,balances:balances.length};
}
