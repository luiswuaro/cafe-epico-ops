"use server";
import {and,eq,desc} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {getNativePurchases} from "@/src/application/purchases/native";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,inventoryItems,itemCostHistory,itemPurchaseUnits,purchasePlans,purchasePlanLines} from "@/src/infrastructure/db/schema";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";

const input=z.object({
  itemId:z.string().uuid(),minimum:z.number().nonnegative().nullable(),
  packageName:z.string().trim().max(100),packageQuantity:z.number().positive().nullable(),
  packagePrice:z.number().nonnegative().nullable(),supplierId:z.string().uuid().nullable(),
});
function optionalNumber(value:FormDataEntryValue|null){
  const v=String(value??"").trim();return v===""?null:Number(v);
}
export async function saveNativePurchaseItem(formData:FormData){
  assertNoPreviewMutation();
  const result=input.safeParse({
    itemId:String(formData.get("itemId")??""),
    minimum:optionalNumber(formData.get("minimum")),
    packageName:String(formData.get("packageName")??"").trim(),
    packageQuantity:optionalNumber(formData.get("packageQuantity")),
    packagePrice:optionalNumber(formData.get("packagePrice")),
    supplierId:String(formData.get("supplierId")??"").trim()||null,
  });
  if(!result.success)redirect("/admin/purchases?error=native-item");
  const v=result.data;
  if((v.packageQuantity===null)!==(v.packagePrice===null) ||
    (v.packageQuantity!==null&&!v.packageName)){
    redirect("/admin/purchases?error=package-pair");
  }
  const {organizationId,user,employeeId}=await requirePermission("purchase.manage");
  const db=getDb();
  await db.transaction(async(tx)=>{
    const [item]=await tx.select({id:inventoryItems.id}).from(inventoryItems)
      .where(and(eq(inventoryItems.id,v.itemId),eq(inventoryItems.organizationId,organizationId),
        eq(inventoryItems.isActive,true),eq(inventoryItems.trackingType,"QUANTITY"))).limit(1);
    if(!item)throw Error("Insumo OPS no encontrado.");
    await tx.update(inventoryItems).set({
      minimumStock:v.minimum===null?null:String(v.minimum),updatedAt:new Date(),
    }).where(and(eq(inventoryItems.id,v.itemId),eq(inventoryItems.organizationId,organizationId)));
    const [existing]=await tx.select({id:itemPurchaseUnits.id}).from(itemPurchaseUnits)
      .where(and(eq(itemPurchaseUnits.organizationId,organizationId),
        eq(itemPurchaseUnits.inventoryItemId,v.itemId),eq(itemPurchaseUnits.isDefault,true)))
      .orderBy(desc(itemPurchaseUnits.updatedAt)).limit(1);
    if(v.packageQuantity!==null&&v.packagePrice!==null){
      if(existing)await tx.update(itemPurchaseUnits).set({
        name:v.packageName,canonicalQuantity:String(v.packageQuantity),
        supplierId:v.supplierId,updatedAt:new Date(),
      }).where(and(eq(itemPurchaseUnits.id,existing.id),eq(itemPurchaseUnits.organizationId,organizationId)));
      else await tx.insert(itemPurchaseUnits).values({
        organizationId,inventoryItemId:v.itemId,name:v.packageName,
        canonicalQuantity:String(v.packageQuantity),supplierId:v.supplierId,isDefault:true,
      });
      // Precio *por unidad canónica*. Mantener historia temporal y no revaluar tickets viejos.
      const newCost=v.packagePrice/v.packageQuantity;
      const [last]=await tx.select({cost:itemCostHistory.costPerCanonicalUnit})
        .from(itemCostHistory).where(and(eq(itemCostHistory.organizationId,organizationId),
          eq(itemCostHistory.inventoryItemId,v.itemId)))
        .orderBy(desc(itemCostHistory.effectiveFrom)).limit(1);
      if(!last||Math.abs(Number(last.cost)-newCost)>0.00000001){
        await tx.insert(itemCostHistory).values({
          organizationId,inventoryItemId:v.itemId,costPerCanonicalUnit:String(newCost),
          source:"OPS_PURCHASE_PACKAGE",effectiveFrom:new Date(),createdBy:user.id,
        });
      }
    } else if(existing){
      // Mínimo solo: NO borrar el empaque ni su precio histórico sin confirmación.
      if(v.supplierId)await tx.update(itemPurchaseUnits)
        .set({supplierId:v.supplierId,updatedAt:new Date()})
        .where(and(eq(itemPurchaseUnits.id,existing.id),eq(itemPurchaseUnits.organizationId,organizationId)));
    }
    await tx.insert(auditEvents).values({organizationId,actorUserId:user.id,
      actorEmployeeId:employeeId,action:"OPS_PURCHASE_ITEM_SETTINGS_SAVED",
      entityType:"inventory_item",entityId:v.itemId,
      afterData:{minimum:v.minimum,packageName:v.packageName,
        packageQuantity:v.packageQuantity,packagePrice:v.packagePrice,supplierId:v.supplierId}});
  });
  revalidatePath("/admin/purchases");
  revalidatePath("/inventory");
  revalidatePath("/admin/analytics");
  redirect("/admin/purchases?setting=saved");
}

export async function createNativePurchasePlan(formData:FormData){
  assertNoPreviewMutation();
  const {organizationId,user,employeeId}=await requirePermission("purchase.manage");
  const data=await getNativePurchases(organizationId);
  const rows=data.suggested;
  if(!rows.length)redirect("/admin/purchases?error=no-purchases");
  const title=String(formData.get("title")??"").trim().slice(0,150)||
    "Reposición OPS · "+new Date().toLocaleDateString("es-MX",{timeZone:"America/Mexico_City"});
  const destination=String(formData.get("destination")??"").trim().slice(0,120)||null;
  const day=String(formData.get("plannedFor")??"").trim();
  const plannedFor=/^\d{4}-\d{2}-\d{2}$/.test(day)?new Date(day+"T12:00:00-06:00"):new Date();
  if(!Number.isFinite(plannedFor.getTime()))redirect("/admin/purchases?error=plan-date");
  const budget=rows.reduce((sum,row)=>sum+(row.suggestion?.estimatedCost??0),0);
  const db=getDb();
  const id=await db.transaction(async(tx)=>{
    const [plan]=await tx.insert(purchasePlans).values({
      organizationId,storeId:data.store.id,title,destination,plannedFor,
      createdBy:user.id,estimatedBudget:String(Math.round(budget*100)/100),
      notes:"Requisición OPS nativa. Importes parciales si hay insumos sin costo; confirmar precios antes de comprar.",
    }).returning({id:purchasePlans.id});
    await tx.insert(purchasePlanLines).values(rows.map(row=>({
      organizationId,purchasePlanId:plan.id,
      inventoryItemId:row.id,variantExternalId:null,itemNameSnapshot:row.name,
      supplierId:row.presentation?.supplierId??null,
      requestedNativeQuantity:String(row.suggestion!.quantity),
      packageCount:row.suggestion!.packages===null?null:String(row.suggestion!.packages),
      packageNameSnapshot:row.presentation?.name??null,
      packageQuantitySnapshot:row.presentation?.canonicalQuantity===undefined?null:
        String(row.presentation.canonicalQuantity),
      unitCostSnapshot:row.unitCost===null?null:String(row.unitCost),
      packagePriceSnapshot:row.unitCost===null||!row.presentation?null:
        String(Math.round(row.unitCost*row.presentation.canonicalQuantity*100)/100),
      estimatedTotal:row.suggestion!.estimatedCost===null?null:
        String(row.suggestion!.estimatedCost),
      note:"Existencia OPS: "+row.stock+" "+row.unit+
        " · consumo diario observado: "+row.averageDaily+" "+row.unit,
    })));
    await tx.insert(auditEvents).values({organizationId,actorUserId:user.id,
      actorEmployeeId:employeeId,action:"OPS_PURCHASE_PLAN_GENERATED",
      entityType:"purchase_plan",entityId:plan.id,
      afterData:{items:rows.length,knownBudget:budget,source:"OPS_NATIVE"}});
    return plan.id;
  });
  revalidatePath("/admin/purchases");
  redirect("/admin/purchases?plan="+id);
}
