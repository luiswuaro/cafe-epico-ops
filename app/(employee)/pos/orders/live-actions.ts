"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPosCatalog } from "@/src/application/pos/catalog";
import { getPosReadiness } from "@/src/application/pos/readiness";
import { isPosLiveEnabled } from "@/src/application/pos/live";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, posCustomers, posOrderLines, posOrderSplits, posOrders } from "@/src/infrastructure/db/schema";

const OPEN=["SENT","PREPARING","READY"];
const additionSchema=z.array(z.object({
  externalId:z.string().min(1),
  quantity:z.number().int().min(1).max(20),
  serviceMode:z.enum(["DINE_IN","TAKEAWAY"]).optional(),
  note:z.string().max(180).nullable().optional(),
})).min(1).max(30);

function message(error:unknown) {
  return (error instanceof Error?error.message:"No se pudo completar la acción.").slice(0,260);
}

export async function addProductsToLiveCommand(data:FormData){
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  if(!isPosLiveEnabled())throw new Error("OPS LIVE no está habilitado.");
  const orderId=z.string().uuid().parse(data.get("orderId"));
  const requestId=z.string().uuid().parse(data.get("requestId"));
  try{
    const cart=additionSchema.parse(JSON.parse(String(data.get("cart")??"[]")));
    const [catalog,readiness]=await Promise.all([
      getPosCatalog(employee.organizationId),
      getPosReadiness(employee.organizationId,employee.homeStoreId),
    ]);
    const catalogById=new Map(catalog.map(x=>[x.id,x]));
    const readyById=new Map(readiness.products.map(x=>[x.id,x]));
    const pilot=process.env.POS_LIVE_PILOT_ITEM?.trim().toLocaleUpperCase("es-MX");
    const db=getDb();
    await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,employee.homeStoreId!),
      )).for("update").limit(1);
      if(!order || order.mode!=="LIVE")throw new Error("Comanda LIVE no encontrada.");
      const [existing]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(
        eq(auditEvents.entityId,order.id),
        eq(auditEvents.action,"POS_LIVE_ORDER_ITEMS_ADDED"),
        sql`${auditEvents.afterData}->>'requestId' = ${requestId}`,
      )).limit(1);
      if(existing)return;
      if(!OPEN.includes(order.status))
        throw new Error("La mesa ya tiene algún cobro o está cerrada. Termina el cobro antes de añadir productos.");
      const splits=await tx.select().from(posOrderSplits).where(eq(posOrderSplits.orderId,order.id));
      if(splits.some(x=>x.status==="PAID"))throw new Error("La mesa ya tiene una cuenta pagada.");
      const lines=cart.map(line=>{
        const item=catalogById.get(line.externalId);
        if(!item||!item.active)throw new Error("Producto no disponible.");
        if(pilot && item.name.toLocaleUpperCase("es-MX")!==pilot)
          throw new Error("Piloto LIVE limitado a "+pilot);
        const rawMode=line.serviceMode??order.serviceMode;
        if(rawMode!=="DINE_IN"&&rawMode!=="TAKEAWAY")throw new Error("Servicio inválido.");
        const lineMode: "DINE_IN"|"TAKEAWAY"=rawMode;
        const state=readyById.get(item.id)?.recipes.find(r=>r.mode===lineMode);
        if(!state?.ready)throw new Error(item.name+" ("+(lineMode==="DINE_IN"?"aquí":"para llevar")+"): "+(state?.errors.join("; ")||"Receta no confirmada"));
        if(line.note?.trim() && line.note.trim().toLocaleLowerCase("es-MX")!=="extra caliente")
          throw new Error("Nota modifica ingredientes; configura la receta de "+item.name);
        const recipe=item.serviceRecipes[lineMode];
        return {item,recipe,lineMode,quantity:line.quantity,note:line.note?.trim()||null,
          lineTotal:Math.round(item.price*line.quantity*100)/100};
      });
      if(splits.length)await tx.delete(posOrderSplits).where(eq(posOrderSplits.orderId,order.id));
      await tx.insert(posOrderLines).values(lines.map(line=>({
        organizationId:employee.organizationId,orderId:order.id,
        catalogExternalId:line.item.id,variantExternalId:line.item.variantExternalId,
        nameSnapshot:line.item.name,categorySnapshot:line.item.category,
        unitPrice:line.item.price.toFixed(2),quantity:String(line.quantity),
        lineTotal:line.lineTotal.toFixed(2),note:line.note,
        expectedConsumption:{
          mode:"LIVE",additionalRound:true,roundId:requestId,serviceMode:line.lineMode,
          sourceRecipeExternalId:line.recipe.externalId,
          components:line.recipe.components.map(c=>({
            variantExternalId:c.variantExternalId,itemExternalId:c.itemExternalId,
            name:c.name,quantity:c.quantity*line.quantity,unitLabel:c.unitLabel,
          })),
        },
      })));
      const added=lines.reduce((sum,line)=>sum+line.lineTotal,0);
      const total=Math.round((Number(order.total)+added)*100)/100;
      await tx.update(posOrders).set({
        total:total.toFixed(2),subtotal:total.toFixed(2),
        loyaltyPointsPreview:(order.customerId?Math.round(total*5)/100:0).toFixed(2),
        status:"SENT",updatedAt:new Date(),
      }).where(eq(posOrders.id,order.id));
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId!,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_LIVE_ORDER_ITEMS_ADDED",entityType:"pos_order",entityId:order.id,
        beforeData:{status:order.status,total:Number(order.total)},
        afterData:{requestId,added,lines:lines.map(x=>({name:x.item.name,quantity:x.quantity,serviceMode:x.lineMode})),
          total,status:"SENT",divisionReset:splits.length>0},
      });
    });
  }catch(error){
    redirect("/pos/orders?error="+encodeURIComponent(message(error)));
  }
  redirect(String(data.get("returnToPos")??"")==="1"
    ? "/pos?ticket="+orderId+"&updated=1"
    : "/pos/orders?added="+orderId);
}

export async function setLiveCommandCustomer(data:FormData){
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const orderId=z.string().uuid().parse(data.get("orderId"));
  const customerId=String(data.get("customerId")??"").trim()||null;
  const db=getDb();
  try{
    await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,employee.homeStoreId!),
      )).for("update").limit(1);
      if(!order||order.mode!=="LIVE"||!OPEN.includes(order.status))
        throw new Error("Solo puedes cambiar el cliente antes de cobrar la mesa.");
      if(customerId){
        const [customer]=await tx.select({id:posCustomers.id}).from(posCustomers).where(and(
          eq(posCustomers.id,customerId),eq(posCustomers.organizationId,employee.organizationId),
          eq(posCustomers.isActive,true),
        )).limit(1);
        if(!customer)throw new Error("Cliente no encontrado o inactivo.");
      }
      await tx.update(posOrders).set({
        customerId,updatedAt:new Date(),
        loyaltyPointsPreview:(customerId?Math.round(Number(order.total)*5)/100:0).toFixed(2),
      }).where(eq(posOrders.id,order.id));
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId!,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_LIVE_COMMAND_CUSTOMER_CHANGED",
        entityType:"pos_order",entityId:order.id,
        beforeData:{customerId:order.customerId},
        afterData:{customerId,loyaltyPointsPreview:customerId?Math.round(Number(order.total)*5)/100:0},
      });
    });
  }catch(error){redirect("/pos/orders?error="+encodeURIComponent(message(error)));}
  redirect("/pos/orders?customer="+orderId);
}

export async function createLiveCommandCustomer(data:FormData){
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal.");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const orderId=z.string().uuid().parse(data.get("orderId"));
  const name=z.string().trim().min(2).max(150).parse(data.get("name"));
  const phone=String(data.get("phone")??"").trim().slice(0,35)||null;
  const db=getDb();
  try{
    await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
      const [order]=await tx.select().from(posOrders).where(and(
        eq(posOrders.id,orderId),eq(posOrders.organizationId,employee.organizationId),
        eq(posOrders.storeId,employee.homeStoreId!),
      )).for("update").limit(1);
      if(!order||order.mode!=="LIVE"||!OPEN.includes(order.status))
        throw new Error("Esta comanda ya no permite asociar clientes.");
      const [customer]=await tx.insert(posCustomers).values({
        organizationId:employee.organizationId,name,phone,pointsBalance:"0",
      }).returning({id:posCustomers.id});
      await tx.update(posOrders).set({
        customerId:customer.id,updatedAt:new Date(),
        loyaltyPointsPreview:(Math.round(Number(order.total)*5)/100).toFixed(2),
      }).where(eq(posOrders.id,order.id));
      await tx.insert(auditEvents).values({
        organizationId:employee.organizationId,storeId:employee.homeStoreId!,
        actorUserId:user.id,actorEmployeeId:employee.id,
        action:"POS_LIVE_COMMAND_CUSTOMER_CREATED",
        entityType:"pos_order",entityId:order.id,
        afterData:{customerId:customer.id,customerName:name,phone},
      });
    });
  }catch(error){redirect("/pos/orders?error="+encodeURIComponent(message(error)));}
  redirect("/pos/orders?customer="+orderId);
}
