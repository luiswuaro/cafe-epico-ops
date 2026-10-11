"use server";

import {and,eq,gte,lt,sql} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requirePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {
  auditEvents, inventoryBalances, inventoryItems, inventoryLocations,
  inventoryMovements, roastBatches, roastCoffeeLots, roastSettings,
} from "@/src/infrastructure/db/schema";
import {grams,roastDayBounds,roastingItemSku,transferProjection} from "@/src/domain/roasting/stock-ledger";

/**
 * Preview and LIVE share the same Supabase database.
 * A preview may show projections, but it MUST NOT mutate physical stock.
 */
function requireProductionWrite(){
  if(process.env.VERCEL_ENV==="preview")
    throw new Error("El preview es de solo lectura. Publica primero la versión validada para contabilizar existencias reales.");
}

async function transactionContext(organizationId:string) {
  const db=getDb();
  const [settings]=await db.select().from(roastSettings)
    .where(eq(roastSettings.organizationId,organizationId)).limit(1);
  if(!settings?.defaultStoreId||!settings.defaultLocationId)
    throw new Error("Configura sucursal y ubicación de producción en Tueste.");
  const [storage]=await db.select().from(inventoryLocations).where(and(
    eq(inventoryLocations.id,settings.defaultLocationId),
    eq(inventoryLocations.organizationId,organizationId),
    eq(inventoryLocations.storeId,settings.defaultStoreId),
    eq(inventoryLocations.isActive,true),
  )).limit(1);
  if(!storage||storage.locationType!=="STORAGE")
    throw new Error("La ubicación de producción debe ser Almacén, no Barra.");
  return {db,storeId:settings.defaultStoreId,storageId:storage.id};
}

/**
 * Recover historical HiBean batches: ONLY missing PRODUCTION_OUTPUT rows on
 * a user-selected roast date. Existing GREEN deductions are NEVER repeated.
 * Creates a per-lot storage SKU so different coffees do not mix in the bag.
 */
export async function postHiBeanRoastedOutput(formData:FormData){
  requireProductionWrite();
  const lotId=String(formData.get("lotId")??"");
  const day=String(formData.get("roastDate")??"");
  const confirmed=String(formData.get("confirmProduction")??"");
  if(!/^[0-9a-f-]{36}$/i.test(lotId)||confirmed!=="yes")
    throw new Error("Selecciona y confirma el lote de producción.");
  const {start,end}=roastDayBounds(day);
  const {user,employeeId,organizationId}=await requirePermission("roast.manage");
  const {db,storeId,storageId}=await transactionContext(organizationId);

  const result=await db.transaction(async tx=>{
    // Serialize with POS LIVE and other inventory writes in this store.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
    const [lot]=await tx.select().from(roastCoffeeLots).where(and(
      eq(roastCoffeeLots.organizationId,organizationId),eq(roastCoffeeLots.id,lotId),
      eq(roastCoffeeLots.isActive,true),
    )).limit(1);
    if(!lot)throw new Error("El lote no existe o está inactivo.");

    const batches=await tx.select().from(roastBatches).where(and(
      eq(roastBatches.organizationId,organizationId),
      eq(roastBatches.coffeeLotId,lotId),
      eq(roastBatches.sourceProvider,"HIBEAN"),
      gte(roastBatches.roastedAt,start),lt(roastBatches.roastedAt,end),
    )).orderBy(roastBatches.roastedAt);
    if(!batches.length)throw new Error("No hay batches HiBean del lote en esa fecha.");

    // Verify the GREEN consumption is already in the ledger. Otherwise stop;
    // importing a curve alone is not authorization to invent finished stock.
    const movements=await tx.select({
      sourceId:inventoryMovements.sourceId,type:inventoryMovements.movementType,
    }).from(inventoryMovements).where(and(
      eq(inventoryMovements.organizationId,organizationId),
      eq(inventoryMovements.sourceType,"ROAST_BATCH"),
    ));
    const greenIds=new Set(movements.filter(m=>m.type==="PRODUCTION_CONSUMPTION").map(m=>m.sourceId));
    const outputIds=new Set(movements.filter(m=>m.type==="PRODUCTION_OUTPUT").map(m=>m.sourceId));
    const pending=batches.filter(b=>!outputIds.has(b.id));
    for(const b of pending){
      if(!greenIds.has(b.id))
        throw new Error("El batch "+b.batchCode+" no tiene consumo verde confirmado en OPS.");
      if(Number(b.roastedWeightG)<=0)
        throw new Error("El batch "+b.batchCode+" no tiene peso tostado válido.");
    }
    if(!pending.length)return {count:0,weight:0,lotName:lot.name};

    const sku=roastingItemSku(lotId);
    let [stockItem]=await tx.select().from(inventoryItems).where(and(
      eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.sku,sku),
    )).limit(1);
    if(!stockItem){
      [stockItem]=await tx.insert(inventoryItems).values({
        organizationId,name:"CAFÉ TOSTADO · "+lot.name,
        sku,category:"CAFÉ TOSTADO",canonicalUnit:"g",trackingType:"QUANTITY",
      }).onConflictDoNothing().returning();
      if(!stockItem){
        [stockItem]=await tx.select().from(inventoryItems).where(and(
          eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.sku,sku),
        )).limit(1);
      }
    }
    if(!stockItem||stockItem.canonicalUnit!=="g"||stockItem.trackingType!=="QUANTITY"||!stockItem.isActive)
      throw new Error("No se pudo verificar el insumo tostado exclusivo de este lote.");

    if(lot.roastedInventoryItemId!==stockItem.id){
      await tx.update(roastCoffeeLots)
        .set({roastedInventoryItemId:stockItem.id,updatedAt:new Date()})
        .where(eq(roastCoffeeLots.id,lotId));
    }

    let posted=0,gramsPosted=0;
    for(const batch of pending){
      const quantity=Number(batch.roastedWeightG);
      const [newMovement]=await tx.insert(inventoryMovements).values({
        organizationId,storeId,locationId:storageId,
        inventoryItemId:stockItem.id,movementType:"PRODUCTION_OUTPUT",
        quantityDelta:quantity.toFixed(3),sourceType:"ROAST_BATCH",
        sourceId:batch.id,occurredAt:batch.roastedAt,employeeId,
        note:"Café tostado a bolsa · "+lot.name+" · "+batch.batchCode,
        externalProvider:"ROASTING",externalId:batch.id+":ROASTED",
      }).onConflictDoNothing().returning({id:inventoryMovements.id});
      if(!newMovement)continue;
      await tx.insert(inventoryBalances).values({
        organizationId,storeId,locationId:storageId,inventoryItemId:stockItem.id,
        theoreticalQuantity:quantity.toFixed(3),
      }).onConflictDoUpdate({
        target:[inventoryBalances.storeId,inventoryBalances.locationId,inventoryBalances.inventoryItemId],
        set:{theoreticalQuantity:sql`${inventoryBalances.theoreticalQuantity} + ${quantity}`,updatedAt:new Date()},
      });
      posted++;
      gramsPosted+=quantity;
    }
    await tx.insert(auditEvents).values({
      organizationId,storeId,actorUserId:user.id,actorEmployeeId:employeeId,
      action:"ROAST_OUTPUT_POSTED",entityType:"roast_coffee_lot",entityId:lotId,
      afterData:{date:day,posted,weightG:Number(gramsPosted.toFixed(3)),sku,batchIds:pending.map(b=>b.id)},
    });
    return {count:posted,weight:gramsPosted,lotName:lot.name};
  });
  revalidatePath("/admin/roasting");
  revalidatePath("/inventory/ops");
  redirect("/admin/roasting?stock=posted&count="+result.count+"&grams="+result.weight.toFixed(3));
}

/**
 * The bag is mixed at lot level; a user chooses the physical weighed amount.
 * Decrease ONLY per-lot warehouse stock; increase generic bar espresso stock,
 * preserving legacy 380 g and POS recipe mappings. No roasting deductions.
 */
export async function transferRoastedBagToHopper(formData:FormData){
  requireProductionWrite();
  const lotId=String(formData.get("lotId")??"");
  const transferId=String(formData.get("operationId")??"");
  const reason=String(formData.get("note")??"").trim();
  const amount=grams(formData.get("quantityG"));
  if(!/^[0-9a-f-]{36}$/i.test(lotId)||!/^[0-9a-f-]{36}$/i.test(transferId))
    throw new Error("Lote u operación inválidos.");
  if(reason.length>300)throw new Error("Nota demasiado larga.");
  const {user,employeeId,organizationId}=await requirePermission("roast.manage");
  const {db,storeId,storageId}=await transactionContext(organizationId);

  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${storeId}))`);
    const idOut="TRANSFER:"+transferId+":OUT",idIn="TRANSFER:"+transferId+":IN";
    const [duplicate]=await tx.select({id:inventoryMovements.id}).from(inventoryMovements).where(and(
      eq(inventoryMovements.organizationId,organizationId),
      eq(inventoryMovements.externalProvider,"ROASTING"),
      eq(inventoryMovements.externalId,idOut),
    )).limit(1);
    if(duplicate)return;

    const [lot]=await tx.select().from(roastCoffeeLots).where(and(
      eq(roastCoffeeLots.id,lotId),eq(roastCoffeeLots.organizationId,organizationId),
    )).limit(1);
    const sku=roastingItemSku(lotId);
    const [stockItem]=await tx.select().from(inventoryItems).where(and(
      eq(inventoryItems.organizationId,organizationId),eq(inventoryItems.sku,sku),
      eq(inventoryItems.isActive,true),
    )).limit(1);
    if(!lot||!stockItem||lot.roastedInventoryItemId!==stockItem.id)
      throw new Error("Primero registra la producción HiBean del lote para crear su bolsa.");

    const [barItem]=await tx.select().from(inventoryItems).where(and(
      eq(inventoryItems.organizationId,organizationId),
      eq(inventoryItems.sku,"CAFE-ESPRESSO"),
      eq(inventoryItems.isActive,true),
    )).limit(1);
    const [bar]=await tx.select().from(inventoryLocations).where(and(
      eq(inventoryLocations.organizationId,organizationId),
      eq(inventoryLocations.storeId,storeId),eq(inventoryLocations.name,"Barra"),
      eq(inventoryLocations.isActive,true),
    )).limit(1);
    if(!bar||!barItem||barItem.id===stockItem.id||barItem.canonicalUnit!=="g")
      throw new Error("Configura insumo de espresso y ubicación Barra antes del traslado.");

    const [bagBalance]=await tx.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,organizationId),
      eq(inventoryBalances.storeId,storeId),
      eq(inventoryBalances.locationId,storageId),
      eq(inventoryBalances.inventoryItemId,stockItem.id),
    )).for("update").limit(1);
    const [barBalance]=await tx.select().from(inventoryBalances).where(and(
      eq(inventoryBalances.organizationId,organizationId),
      eq(inventoryBalances.storeId,storeId),
      eq(inventoryBalances.locationId,bar.id),
      eq(inventoryBalances.inventoryItemId,barItem.id),
    )).for("update").limit(1);
    if(!bagBalance||!barBalance)
      throw new Error("Falta saldo de bolsa o tolva. Revisa primero el inventario inicial.");
    const projected=transferProjection(Number(bagBalance.theoreticalQuantity),
      Number(barBalance.theoreticalQuantity),amount.toFixed(3));
    const now=new Date();
    const common={organizationId,storeId,sourceType:"ROAST_BAG_TO_HOPPER",
      sourceId:transferId,occurredAt:now,employeeId,externalProvider:"ROASTING",
      note:"Traslado a tolva · "+lot.name+" · "+amount.toFixed(3)+" g"+(reason?" · "+reason:"")};
    await tx.insert(inventoryMovements).values([{
      ...common,locationId:storageId,inventoryItemId:stockItem.id,
      movementType:"TRANSFER_OUT",quantityDelta:(-amount).toFixed(3),
      externalId:idOut,
    },{
      ...common,locationId:bar.id,inventoryItemId:barItem.id,
      movementType:"TRANSFER_IN",quantityDelta:amount.toFixed(3),
      externalId:idIn,
    }]);
    await tx.update(inventoryBalances).set({
      theoreticalQuantity:projected.bagAfterG.toFixed(3),updatedAt:now,
    }).where(and(eq(inventoryBalances.storeId,storeId),
      eq(inventoryBalances.locationId,storageId),
      eq(inventoryBalances.inventoryItemId,stockItem.id)));
    await tx.update(inventoryBalances).set({
      theoreticalQuantity:projected.barAfterG.toFixed(3),updatedAt:now,
    }).where(and(eq(inventoryBalances.storeId,storeId),
      eq(inventoryBalances.locationId,bar.id),
      eq(inventoryBalances.inventoryItemId,barItem.id)));
    await tx.insert(auditEvents).values({
      organizationId,storeId,actorUserId:user.id,actorEmployeeId:employeeId,
      action:"ROAST_BAG_TO_HOPPER_TRANSFER",entityType:"roast_coffee_lot",entityId:lotId,
      beforeData:{bagG:Number(bagBalance.theoreticalQuantity),barG:Number(barBalance.theoreticalQuantity)},
      afterData:{transferId,amountG:amount,bagG:projected.bagAfterG,barG:projected.barAfterG,barItemId:barItem.id,note:reason},
    });
  });
  revalidatePath("/admin/roasting");
  revalidatePath("/inventory/ops");
  revalidatePath("/pos");
  redirect("/admin/roasting?stock=transferred");
}
