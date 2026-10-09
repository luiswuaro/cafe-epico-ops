import { and, eq, sql } from "drizzle-orm";
import { getPosCatalog, type PosServiceMode } from "@/src/application/pos/catalog";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents, inventoryBalances, inventoryItems, inventoryMovements,
  loyverseInventoryMappings, posCashMovements, posCashSessions, posCustomers,
  posLoyaltyEntries, posOrderLines, posOrders, posPayments,
} from "@/src/infrastructure/db/schema";

export type LiveCart = Array<{
  externalId: string;
  quantity: number;
  note: string | null;
}>;

export function isPosLiveEnabled() {
  return process.env.POS_LIVE_ENABLED === "true";
}

function businessDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(date);
}
function mapKey(locationId:string,itemId:string) {
  return locationId + ":" + itemId;
}

export async function checkoutLiveOrder(input:{
  organizationId:string;
  storeId:string;
  employeeId:string;
  actorUserId:string;
  clientOrderId:string;
  cart:LiveCart;
  customerId:string|null;
  serviceMode:PosServiceMode;
  paymentMethod:"CASH"|"CARD"|"TRANSFER";
  tenderedAmount:number|null;
  tableLabel:string|null;
  note:string|null;
}) {
  if(!isPosLiveEnabled()) throw new Error("Cobros LIVE deshabilitados por seguridad.");
  if(input.cart.length===0 || input.cart.length>30) throw new Error("Carrito inválido.");
  const catalog=await getPosCatalog(input.organizationId);
  const products=new Map(catalog.map(item=>[item.id,item]));
  const lines=input.cart.map(line=>{
    const item=products.get(line.externalId);
    if(!item || !item.active || line.quantity<1 || !Number.isInteger(line.quantity) || line.quantity>20){
      throw new Error("Producto no disponible para la venta.");
    }
    if(item.serviceRecipes[input.serviceMode].components.length===0) {
      throw new Error("La receta de "+item.name+" no tiene insumos configurados.");
    }
    return {
      ...line,item,price:item.price,
      total:Number((item.price*line.quantity).toFixed(2)),
      components:item.serviceRecipes[input.serviceMode].components.map(c=>({
        ...c,quantity:c.quantity*line.quantity,
      })),
    };
  });
  const total=Number(lines.reduce((sum,line)=>sum+line.total,0).toFixed(2));
  if(total<=0) throw new Error("El total de la venta es inválido.");
  if(input.paymentMethod==="CASH" &&
    (input.tenderedAmount===null || !Number.isFinite(input.tenderedAmount) ||
      input.tenderedAmount < total || input.tenderedAmount > 1000000)) {
    throw new Error("El efectivo entregado debe ser mayor o igual al total.");
  }
  const db=getDb();
  const now=new Date();
  const result=await db.transaction(async tx=>{
    // Serializar cobros de una sucursal: validación de caja, inventario y cliente es atómica.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.storeId}))`);
    const [duplicate]=await tx.select({id:posOrders.id}).from(posOrders).where(and(
      eq(posOrders.organizationId,input.organizationId),
      eq(posOrders.clientOrderId,input.clientOrderId),
    )).limit(1);
    if(duplicate) return {id:duplicate.id,alreadyRecorded:true};

    const [session]=await tx.select().from(posCashSessions).where(and(
      eq(posCashSessions.organizationId,input.organizationId),
      eq(posCashSessions.storeId,input.storeId),
      eq(posCashSessions.status,"OPEN"),
    )).limit(1);
    if(!session) throw new Error("Abre una caja operativa antes de cobrar.");
    
    if(input.customerId){
      const [customer]=await tx.select({id:posCustomers.id}).from(posCustomers).where(and(
        eq(posCustomers.id,input.customerId),
        eq(posCustomers.organizationId,input.organizationId),
        eq(posCustomers.isActive,true),
      )).limit(1);
      if(!customer) throw new Error("Cliente no válido.");
    }

    const mappings=await tx.select({
      externalId:loyverseInventoryMappings.loyverseVariantExternalId,
      locationId:loyverseInventoryMappings.locationId,
      inventoryItemId:loyverseInventoryMappings.inventoryItemId,
      factor:loyverseInventoryMappings.factorToCanonical,
      unit:inventoryItems.canonicalUnit,
    }).from(loyverseInventoryMappings)
      .innerJoin(inventoryItems,eq(inventoryItems.id,loyverseInventoryMappings.inventoryItemId))
      .where(and(
        eq(loyverseInventoryMappings.organizationId,input.organizationId),
        eq(loyverseInventoryMappings.storeId,input.storeId),
        eq(loyverseInventoryMappings.isActive,true),
        eq(inventoryItems.isActive,true),
      ));
    const byExternal=new Map(mappings.map(mapping=>[mapping.externalId,mapping]));
    const consume=new Map<string,{locationId:string;itemId:string;amount:number;unit:string;names:Set<string>}>();
    for(const line of lines){
      for(const component of line.components){
        const map=component.variantExternalId ? byExternal.get(component.variantExternalId) : undefined;
        if(!map) throw new Error("Insumo sin equivalencia confirmada: "+component.name+" ("+line.item.name+").");
        const factor=Number(map.factor);
        const amount=Math.round(component.quantity*factor*1000)/1000;
        if(!(amount>0) || !Number.isFinite(amount)){
          throw new Error("Unidad o cantidad no válida en "+component.name);
        }
        const key=mapKey(map.locationId,map.inventoryItemId);
        const existing=consume.get(key);
        if(existing){
          existing.amount=Math.round((existing.amount+amount)*1000)/1000;
          existing.names.add(line.item.name);
        } else {
          consume.set(key,{locationId:map.locationId,itemId:map.inventoryItemId,unit:map.unit,
            amount,names:new Set([line.item.name])});
        }
      }
    }

    const stocks=await tx.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,input.organizationId),
      eq(inventoryBalances.storeId,input.storeId),
    ));
    const byStock=new Map(stocks.map(stock=>[mapKey(stock.locationId,stock.inventoryItemId),stock]));
    for(const [key,requested] of consume){
      const stock=byStock.get(key);
      if(!stock) throw new Error("Falta confirmar el saldo inicial del insumo usado en "+[...requested.names].join(", "));
      if(Number(stock.theoreticalQuantity)+0.000001 < requested.amount){
        throw new Error("Inventario insuficiente en "+[...requested.names].join(", ")+
          " (necesario: "+requested.amount+" "+requested.unit+").");
      }
    }

    const [order]=await tx.insert(posOrders).values({
      organizationId:input.organizationId,storeId:input.storeId,
      employeeId:input.employeeId,clientOrderId:input.clientOrderId,
      folio:"OP-"+now.toISOString().replace(/[-:TZ.]/g,"").slice(0,14)+"-"+input.clientOrderId.slice(-5).toUpperCase(),
      mode:"LIVE",status:"PAID",serviceMode:input.serviceMode,
      tableLabel:input.serviceMode==="DINE_IN"?input.tableLabel:null,
      customerId:input.customerId,businessDate:businessDate(now),
      subtotal:total.toFixed(2),total:total.toFixed(2),note:input.note,
      loyaltyPointsPreview:(input.customerId?total*0.05:0).toFixed(2),
      loyaltyEffectApplied:Boolean(input.customerId),inventoryEffectApplied:true,paidAt:now,
    }).returning({id:posOrders.id,folio:posOrders.folio});
    await tx.insert(posOrderLines).values(lines.map(line=>({
      organizationId:input.organizationId,orderId:order.id,
      catalogExternalId:line.item.id,variantExternalId:line.item.variantExternalId,
      nameSnapshot:line.item.name,categorySnapshot:line.item.category,
      unitPrice:line.price.toFixed(2),quantity:String(line.quantity),lineTotal:line.total.toFixed(2),
      note:line.note,expectedConsumption:{
        mode:"LIVE",serviceMode:input.serviceMode,
        components:line.components,
      },
    })));
    await tx.insert(posPayments).values({
      organizationId:input.organizationId,orderId:order.id,method:input.paymentMethod,
      amount:total.toFixed(2),
      tenderedAmount:input.paymentMethod==="CASH" ? input.tenderedAmount!.toFixed(2) : null,
      changeAmount:input.paymentMethod==="CASH" ? (input.tenderedAmount!-total).toFixed(2) : null,
    });
    if(input.paymentMethod==="CASH"){
      await tx.insert(posCashMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        sessionId:session.id,orderId:order.id,employeeId:input.employeeId,
        movementType:"SALE",amount:total.toFixed(2),note:order.folio,
      });
    }

    for(const item of consume.values()){
      await tx.insert(inventoryMovements).values({
        organizationId:input.organizationId,storeId:input.storeId,
        locationId:item.locationId,inventoryItemId:item.itemId,
        movementType:"SALE",quantityDelta:(-item.amount).toFixed(3),
        sourceType:"POS_LIVE_ORDER",sourceId:order.id,occurredAt:now,
        employeeId:input.employeeId,note:order.folio,
        externalProvider:"OPS_POS",externalId:order.id,
      });
      await tx.update(inventoryBalances).set({
        theoreticalQuantity:sql`${inventoryBalances.theoreticalQuantity} - ${item.amount}`,
        updatedAt:now,
      }).where(and(
        eq(inventoryBalances.storeId,input.storeId),
        eq(inventoryBalances.locationId,item.locationId),
        eq(inventoryBalances.inventoryItemId,item.itemId),
      ));
    }

    if(input.customerId){
      const earned=Math.round(total*5)/100;
      if(earned>0){
        await tx.update(posCustomers).set({
          pointsBalance:sql`${posCustomers.pointsBalance} + ${earned}`,
          updatedAt:now,
        }).where(and(eq(posCustomers.id,input.customerId),eq(posCustomers.organizationId,input.organizationId)));
        await tx.insert(posLoyaltyEntries).values({
          organizationId:input.organizationId,customerId:input.customerId,
          orderId:order.id,entryType:"EARN",points:earned.toFixed(2),note:"Compra "+order.folio,
        });
      }
    }
    await tx.insert(auditEvents).values({
      organizationId:input.organizationId,storeId:input.storeId,
      actorUserId:input.actorUserId,actorEmployeeId:input.employeeId,
      action:"POS_LIVE_SALE_PAID",entityType:"pos_order",entityId:order.id,
      afterData:{folio:order.folio,total,payment:input.paymentMethod,consumptionCount:consume.size,
        customerId:input.customerId,inventoryEffectApplied:true,loyaltyEffectApplied:Boolean(input.customerId)},
    });
    return {id:order.id,alreadyRecorded:false};
  });
  return result;
}
