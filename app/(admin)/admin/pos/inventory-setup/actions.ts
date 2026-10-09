"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getPosInventorySetup } from "@/src/application/pos/inventory-setup";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,inventoryBalances,inventoryItems,inventoryLocations,
  inventoryMovements,loyverseInventoryMappings,
} from "@/src/infrastructure/db/schema";

export async function confirmPosInventorySetup(formData:FormData){
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId) throw new Error("Sin sucursal asignada.");
  for(const permission of ["integration.manage","inventory.adjust","inventory.item.manage"] as const){
    await assertEmployeePermission(employee.id,permission,employee.homeStoreId);
  }
  if(formData.get("physicalConfirmed")!=="yes"){
    throw new Error("Confirma antes los saldos físicos de los artículos seleccionados.");
  }
  const setup=await getPosInventorySetup(employee.organizationId,employee.homeStoreId);
  if(!setup.sourceStore) throw new Error("Selecciona primero la tienda origen de Loyverse.");
  const locationIds=new Set(setup.locations.map(l=>l.id));
  const selected=setup.candidates.filter(row=>formData.get("selected:"+row.id)==="yes"&&!row.mapped);
  if(selected.length===0) throw new Error("Selecciona al menos un insumo sin mapear.");
  if(selected.length>100) throw new Error("Demasiados insumos para una sola operación.");
  const data=selected.map(row=>{
    if(!row.sourceAvailable) throw new Error("Variante no sincronizada: "+row.name);
    const raw=String(formData.get("quantity:"+row.id)??"").trim();
    if(raw==="") throw new Error("Escribe el saldo físico de "+row.name);
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>10000000||Math.round(n*1000)/1000!==n){
      throw new Error("Saldo inválido en "+row.name+"; usa máximo tres decimales.");
    }
    const locationId=String(formData.get("location:"+row.id)??"");
    if(!locationIds.has(locationId)) throw new Error("Ubicación inválida para "+row.name);
    return {...row,quantity:n,locationId};
  });
  const now=new Date(),db=getDb();
  await db.transaction(async tx=>{
    const inserted:{id:string,name:string,qty:number,unit:string}[]=[];
    for(const row of data){
      const [existing]=await tx.select().from(loyverseInventoryMappings).where(and(
        eq(loyverseInventoryMappings.organizationId,employee.organizationId),
        eq(loyverseInventoryMappings.storeId,employee.homeStoreId!),
        eq(loyverseInventoryMappings.loyverseStoreExternalId,setup.sourceStore!),
        eq(loyverseInventoryMappings.loyverseVariantExternalId,row.id),
      )).limit(1);
      if(existing) throw new Error("El mapeo de "+row.name+" cambió; actualiza la página.");
      const [item]=await tx.insert(inventoryItems).values({
        organizationId:employee.organizationId,
        sku:"POS-LV-"+row.id.slice(0,32),
        name:row.name,
        category:"INSUMO_LOYVERSE",
        canonicalUnit:row.unit,
        trackingType:"QUANTITY",
      }).returning({id:inventoryItems.id});
      await tx.insert(loyverseInventoryMappings).values({
        organizationId:employee.organizationId,
        storeId:employee.homeStoreId!,
        locationId:row.locationId,
        inventoryItemId:item.id,
        loyverseStoreExternalId:setup.sourceStore!,
        loyverseVariantExternalId:row.id,
        sourceMode:row.weighted?"FRACTIONAL":"UNIT",
        sourceUnit:row.weighted?"kg":"pz",
        factorToCanonical:row.weighted?"1000":"1",
        isActive:true,
      });
      await tx.insert(inventoryBalances).values({
        organizationId:employee.organizationId,
        storeId:employee.homeStoreId!,
        locationId:row.locationId,inventoryItemId:item.id,
        theoreticalQuantity:row.quantity.toFixed(3),
      });
      if(row.quantity>0)await tx.insert(inventoryMovements).values({
        organizationId:employee.organizationId,
        storeId:employee.homeStoreId!,
        locationId:row.locationId,
        inventoryItemId:item.id,
        movementType:"OPENING_BALANCE",
        quantityDelta:row.quantity.toFixed(3),
        sourceType:"POS_LIVE_INITIAL_COUNT",
        sourceId:row.id,
        occurredAt:now,
        employeeId:employee.id,
        note:"Saldo inicial declarado y confirmado por responsable; origen Loyverse",
      });
      inserted.push({id:item.id,name:row.name,qty:row.quantity,unit:row.unit});
    }
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,
      storeId:employee.homeStoreId!,
      actorUserId:user.id,
      actorEmployeeId:employee.id,
      action:"POS_INVENTORY_INITIAL_COUNTS_CONFIRMED",
      entityType:"inventory_setup",
      entityId:employee.homeStoreId!,
      afterData:{count:inserted.length,items:inserted,source:"LOYVERSE",
        note:"Confirmación manual de cantidades; no se tomó el saldo sugerido sin confirmación."},
    });
  });
  redirect("/admin/pos/inventory-setup?added="+data.length);
}
