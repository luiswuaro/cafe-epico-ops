"use server";

import {and,eq} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getPosCatalog,type PosServiceMode} from "@/src/application/pos/catalog";
import {getDb} from "@/src/infrastructure/db/client";
import {previewRelinkSnapshot} from "@/src/domain/pos/relink-snapshot";
import {
 auditEvents,inventoryItems,inventoryLocations,posOrderLines,
 posOrders,posOrderSplits,
} from "@/src/infrastructure/db/schema";

const OPEN=["SENT","PREPARING","READY"];
export async function relinkSavedTicketInventory(form:FormData){
  const orderId=z.string().uuid().parse(form.get("orderId"));
  const back="/pos/checkout?ticket="+encodeURIComponent(orderId);
  if(process.env.VERCEL_ENV==="preview")
    throw new Error("La reconciliación de tickets LIVE está bloqueada en el preview.");
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const catalog=await getPosCatalog(employee.organizationId,{includeDisabled:true});
  const productById=new Map(catalog.map(product=>[product.id,product]));
  const db=getDb();
  let result:{lines:number;components:number};
  try{
    result=await db.transaction(async tx=>{
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,employee.homeStoreId!),
      )).for("update").limit(1);
      if(!order||order.mode!=="LIVE"||!OPEN.includes(order.status)||order.paidAt)
        throw new Error("Sólo pueden reconciliarse tickets LIVE guardados, abiertos y sin cobrar.");
      const splits=await tx.select({id:posOrderSplits.id}).from(posOrderSplits)
        .where(eq(posOrderSplits.orderId,order.id)).limit(1);
      if(splits.length)throw new Error("La cuenta ya está dividida; no se pueden cambiar sus componentes.");
      const lines=await tx.select().from(posOrderLines).where(and(
        eq(posOrderLines.orderId,order.id),
        eq(posOrderLines.organizationId,employee.organizationId),
      )).for("update");
      if(!lines.length)throw new Error("La comanda no tiene productos.");
      const [items,locations]=await Promise.all([
        tx.select({
          id:inventoryItems.id,unit:inventoryItems.canonicalUnit,
          policy:inventoryItems.trackingType,
        }).from(inventoryItems).where(and(
          eq(inventoryItems.organizationId,employee.organizationId),
          eq(inventoryItems.isActive,true),
        )),
        tx.select({id:inventoryLocations.id}).from(inventoryLocations).where(and(
          eq(inventoryLocations.organizationId,employee.organizationId),
          eq(inventoryLocations.storeId,employee.homeStoreId!),
          eq(inventoryLocations.isActive,true),
        )),
      ]);
      const byId=new Map(items.map(item=>[item.id,item]));
      const validLocations=new Set(locations.map(loc=>loc.id));
      const pending:Array<{id:string;
        next:Record<string,unknown>;linked:Array<{name:string;quantity:number;unit:string}>}>=[];
      for(const line of lines){
        const product=productById.get(line.catalogExternalId);
        if(!product)throw new Error("El producto "+line.nameSnapshot+" no existe en el catálogo.");
        const expected=line.expectedConsumption;
        const service=expected.serviceMode;
        if(service!=="DINE_IN"&&service!=="TAKEAWAY")
          throw new Error("Servicio guardado inválido para "+line.nameSnapshot);
        const recipe=product.serviceRecipes[service as PosServiceMode];
        const check=previewRelinkSnapshot(expected.components,recipe.components,Number(line.quantity));
        if(check.issues.length)
          throw new Error("No se modificó el ticket. "+check.issues[0]+" Verifica la receta de OPS.");
        if(!check.linked.length)continue;
        for(const c of check.components){
          if(!c.inventoryItemId||!c.inventoryLocationId)continue;
          const item=byId.get(String(c.inventoryItemId));
          if(!item||item.policy!=="QUANTITY"||item.unit!==c.unitLabel||
             !validLocations.has(String(c.inventoryLocationId)))
            throw new Error("Insumo OPS inactivo o unidad/ubicación no válida: "+String(c.name));
        }
        pending.push({id:line.id,next:{...expected,components:check.components},linked:check.linked});
      }
      if(pending.length===0)
        throw new Error("No se encontraron ingredientes reconciliables. Guarda primero la receta de ICEE en Catálogo OPS.");
      for(const line of pending){
        await tx.update(posOrderLines).set({expectedConsumption:line.next})
          .where(and(eq(posOrderLines.id,line.id),eq(posOrderLines.orderId,order.id)));
      }
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId!,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_LIVE_SAVED_INGREDIENTS_RELINKED",entityType:"pos_order",entityId:order.id,
        beforeData:{status:order.status,orderTotal:order.total,
          linked:pending.map(p=>({lineId:p.id,ingredients:p.linked.map(x=>x.name)}))},
        afterData:{status:order.status,orderTotal:order.total,
          lines:pending.length,components:pending.reduce((n,p)=>n+p.linked.length,0),
          policy:"IDS_ONLY_SAME_QUANTITY_NO_PAYMENT_NO_KITCHEN"},
      });
      return {lines:pending.length,
        components:pending.reduce((n,p)=>n+p.linked.length,0)};
    });
  }catch(e){
    const message=e instanceof Error?e.message:"No se pudo reconciliar el ticket.";
    redirect(back+"&error="+encodeURIComponent(message.slice(0,300)));
  }
  revalidatePath("/pos/checkout");
  revalidatePath("/pos/orders");
  redirect(back+"&relinked="+result.components);
}
