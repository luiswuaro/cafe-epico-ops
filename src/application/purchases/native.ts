import {and,asc,desc,eq,inArray} from "drizzle-orm";
import {getOpsInventoryIntelligence} from "@/src/application/inventory/ops-intelligence";
import {nativePurchaseSuggestion} from "@/src/domain/purchases/native-suggestion";
import {getDb} from "@/src/infrastructure/db/client";
import {inventoryItems,itemCostHistory,itemPurchaseUnits,purchasePlans,purchasePlanLines,stores,suppliers} from "@/src/infrastructure/db/schema";

export async function getNativePurchases(organizationId:string){
  const db=getDb();
  const [store]=await db.select({id:stores.id,name:stores.name}).from(stores)
    .where(and(eq(stores.organizationId,organizationId),eq(stores.isActive,true))).limit(1);
  if(!store)throw new Error("Configura una sucursal activa para las compras OPS.");
  const [intelligence,items,units,costs,supplierRows,plans]=await Promise.all([
    getOpsInventoryIntelligence(organizationId,store.id),
    db.select({id:inventoryItems.id,name:inventoryItems.name,
      category:inventoryItems.category,unit:inventoryItems.canonicalUnit,
      minimum:inventoryItems.minimumStock})
      .from(inventoryItems).where(and(eq(inventoryItems.organizationId,organizationId),
        eq(inventoryItems.isActive,true),eq(inventoryItems.trackingType,"QUANTITY")))
      .orderBy(asc(inventoryItems.name)),
    db.select().from(itemPurchaseUnits)
      .where(eq(itemPurchaseUnits.organizationId,organizationId))
      .orderBy(desc(itemPurchaseUnits.isDefault),desc(itemPurchaseUnits.updatedAt)),
    db.select({itemId:itemCostHistory.inventoryItemId,
      price:itemCostHistory.costPerCanonicalUnit,
      effectiveFrom:itemCostHistory.effectiveFrom})
      .from(itemCostHistory)
      .where(eq(itemCostHistory.organizationId,organizationId))
      .orderBy(desc(itemCostHistory.effectiveFrom)),
    db.select({id:suppliers.id,name:suppliers.name,city:suppliers.city,isActive:suppliers.isActive})
      .from(suppliers).where(eq(suppliers.organizationId,organizationId))
      .orderBy(asc(suppliers.name)),
    db.select().from(purchasePlans).where(eq(purchasePlans.organizationId,organizationId))
      .orderBy(desc(purchasePlans.createdAt)).limit(20),
  ]);
  const planIds=plans.map(p=>p.id);
  const lines=planIds.length?await db.select().from(purchasePlanLines)
    .where(and(eq(purchasePlanLines.organizationId,organizationId),inArray(purchasePlanLines.purchasePlanId,planIds))):[];
  const byStock=new Map(intelligence.smartRows.map(row=>[row.variantExternalId,row]));
  const byPresentation=new Map<string,typeof units[number]>();
  for(const unit of units)if(!byPresentation.has(unit.inventoryItemId))byPresentation.set(unit.inventoryItemId,unit);
  const byCost=new Map<string,number>();
  for(const cost of costs)if(!byCost.has(cost.itemId)&&cost.effectiveFrom<=new Date())
    byCost.set(cost.itemId,Number(cost.price));
  const rows=items.map(item=>{
    const status=byStock.get(item.id);
    const presentation=byPresentation.get(item.id);
    const stock=status?.inStock??0,averageDaily=status?.avgDailyUsage14??0;
    const unitCost=byCost.get(item.id)??null;
    const packQty=presentation?Number(presentation.canonicalQuantity):null;
    const suggestion=nativePurchaseSuggestion({
      stock,minimum:item.minimum==null?null:Number(item.minimum),
      averageDaily,sampleDays:intelligence.sampleDays,
      packageQuantity:packQty,unitCost,
    });
    return {...item,stock,averageDaily,unitCost,suggestion,
      minimum:item.minimum==null?null:Number(item.minimum),
      presentation:presentation?{id:presentation.id,name:presentation.name,
        canonicalQuantity:packQty!,supplierId:presentation.supplierId}:null};
  });
  return {store,sampleDays:intelligence.sampleDays,rows,
    suggested:rows.filter(row=>row.suggestion!==null),
    suppliers:supplierRows,plans:plans.map(plan=>({...plan,lines:lines.filter(x=>x.purchasePlanId===plan.id)}))};
}
