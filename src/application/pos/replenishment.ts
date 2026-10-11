import {and,eq} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {inventoryBalances,inventoryItems} from "@/src/infrastructure/db/schema";
import {getPosCatalog} from "@/src/application/pos/catalog";
import {isCostOnlyComponent} from "@/src/application/pos/component-policy";
import {buildReplenishmentQueue,type StockForReplenishment,
 type RecipeConsumption} from "@/src/domain/inventory/replenishment-queue";

/** Consolidado sucursal: cuenta todas sus ubicaciones, sin contar agua ni hielo. */
export async function getOpsReplenishmentQueue(organizationId:string,storeId:string){
 const db=getDb();
 const [items,catalog]=await Promise.all([
   db.select({id:inventoryItems.id,name:inventoryItems.name,
     unit:inventoryItems.canonicalUnit,minimum:inventoryItems.minimumStock,
     locationId:inventoryBalances.locationId,
     theoretical:inventoryBalances.theoreticalQuantity})
     .from(inventoryItems).leftJoin(inventoryBalances,and(
       eq(inventoryBalances.inventoryItemId,inventoryItems.id),
       eq(inventoryBalances.organizationId,organizationId),
       eq(inventoryBalances.storeId,storeId),
     )).where(and(eq(inventoryItems.organizationId,organizationId),
       eq(inventoryItems.isActive,true),eq(inventoryItems.trackingType,"QUANTITY"))),
   getPosCatalog(organizationId),
 ]);
 const byItem=new Map<string,StockForReplenishment>();
 for(const row of items){
   const current=byItem.get(row.id);
   if(!current){
     byItem.set(row.id,{id:row.id,name:row.name,unit:row.unit,
       minimum:row.minimum===null?null:Number(row.minimum),
       balance:row.locationId===null?null:Number(row.theoretical)});
   }else if(row.locationId!==null){
     current.balance=(current.balance??0)+Number(row.theoretical);
   }
 }
 const consumptions:RecipeConsumption[]=[];
 for(const product of catalog){
   for(const mode of ["DINE_IN","TAKEAWAY"] as const){
     const serviceRecipe=product.serviceRecipes[mode];
     if(!serviceRecipe.configured)continue;
     for(const component of serviceRecipe.components){
       if(!component.inventoryItemId||isCostOnlyComponent(component))continue;
       consumptions.push({inventoryItemId:component.inventoryItemId,
         product:product.name,quantity:Number(component.quantity),
         unit:component.unitLabel});
     }
   }
 }
 return buildReplenishmentQueue([...byItem.values()],consumptions);
}
