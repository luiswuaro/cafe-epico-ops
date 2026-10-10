"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOpsInventoryIntelligence } from "@/src/application/inventory/ops-intelligence";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import {
  auditEvents,
  operationalEvents,
} from "@/src/infrastructure/db/schema";

export async function reportBarWaste(formData: FormData) {
  // Registro operativo de lo que pasó en barra; los ajustes de saldo se
  // registran por separado en Inventario OPS y quedan auditados.
  const itemId=String(formData.get("variantExternalId")??"").trim();
  const quantity=Number(formData.get("quantity"));
  const reason=String(formData.get("reason")??"OTRO").trim();
  const note=String(formData.get("note")??"").trim()||null;
  if(!itemId||!Number.isFinite(quantity)||quantity<=0||quantity>1000000)
    redirect("/today?error=waste");
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)redirect("/today?error=store");
  await assertEmployeePermission(employee.id,"inventory.waste",employee.homeStoreId);
  const ops=await getOpsInventoryIntelligence(employee.organizationId,employee.homeStoreId);
  const item=ops.smartRows.find(row=>row.variantExternalId===itemId);
  if(!item)redirect("/today?error=waste-item");
  const db=getDb();
  const [created]=await db.insert(operationalEvents).values({
    organizationId:employee.organizationId,storeId:employee.homeStoreId,
    employeeId:employee.id,eventType:reason==="REMAKE"?"REMAKE":"WASTE",
    severity:quantity>=Math.max(1,item.avgDailyUsage14*0.2)?"IMPORTANT":"NORMAL",
    variantExternalId:itemId,itemNameSnapshot:item.itemName,
    quantity:String(quantity),unitLabel:item.unitLabel,
    displayQuantity:String(quantity),displayUnit:item.unitLabel,
    note:reason+(note?" · "+note:""),
    resolvedAt:new Date(),resolvedByEmployeeId:employee.id,
  }).returning({id:operationalEvents.id});
  await db.insert(auditEvents).values({
    organizationId:employee.organizationId,storeId:employee.homeStoreId,
    actorUserId:user.id,actorEmployeeId:employee.id,
    action:reason==="REMAKE"?"BAR_REMAKE_RECORDED_OPS":"BAR_WASTE_RECORDED_OPS",
    entityType:"operational_event",entityId:created.id,
    afterData:{inventoryItemId:itemId,itemName:item.itemName,quantity,
      unit:item.unitLabel,reason,note,inventoryBalanceChanged:false},
  });
  revalidatePath("/today");
  revalidatePath("/handoff");
  redirect("/today?saved=waste");
}

export async function reportQuickStockCount(formData: FormData) {
  const itemId=String(formData.get("variantExternalId")??"").trim();
  const raw=String(formData.get("physicalQuantity")??"").trim();
  const physical=Number(raw);
  const note=String(formData.get("note")??"").trim()||null;
  if(!itemId||!raw||!Number.isFinite(physical)||physical<0||physical>1000000)
    redirect("/today?error=stock-count");
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)redirect("/today?error=store");
  await assertEmployeePermission(employee.id,"inventory.count",employee.homeStoreId);
  const ops=await getOpsInventoryIntelligence(employee.organizationId,employee.homeStoreId);
  const item=ops.smartRows.find(row=>row.variantExternalId===itemId);
  if(!item)redirect("/today?error=stock-count-item");
  const difference=physical-item.inStock;
  const tolerance=item.unitLabel==="pz"?0.49:Math.max(0.001,Math.abs(item.inStock)*0.02);
  const hasDiscrepancy=Math.abs(difference)>tolerance;
  const now=new Date(),db=getDb();
  const created=await db.transaction(async tx=>{
    await tx.update(operationalEvents).set({
      resolvedAt:now,resolvedByEmployeeId:employee.id,
    }).where(and(
      eq(operationalEvents.organizationId,employee.organizationId),
      eq(operationalEvents.storeId,employee.homeStoreId!),
      eq(operationalEvents.eventType,"STOCK_COUNT"),
      eq(operationalEvents.variantExternalId,itemId),
      isNull(operationalEvents.resolvedAt),
    ));
    const [event]=await tx.insert(operationalEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      employeeId:employee.id,eventType:"STOCK_COUNT",
      severity:hasDiscrepancy?"IMPORTANT":"NORMAL",
      variantExternalId:itemId,itemNameSnapshot:item.itemName,
      quantity:String(physical),unitLabel:item.unitLabel,
      displayQuantity:String(physical),displayUnit:item.unitLabel,
      note:"Conteo físico OPS · teórico "+item.inStock.toFixed(3)+" "+item.unitLabel+
        " · diferencia "+(difference>=0?"+":"")+difference.toFixed(3)+" "+item.unitLabel+
        (note?" · "+note:""),
      resolvedAt:hasDiscrepancy?null:now,
      resolvedByEmployeeId:hasDiscrepancy?null:employee.id,
    }).returning({id:operationalEvents.id});
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"OPS_STOCK_COUNT_RECORDED",entityType:"operational_event",entityId:event.id,
      afterData:{inventoryItemId:itemId,itemName:item.itemName,
        theoretical:item.inStock,physicalQuantity:physical,difference,tolerance,
        requiresAdminReconciliation:hasDiscrepancy,inventoryBalanceChanged:false,note},
    });
    return event;
  });
  revalidatePath("/today");
  revalidatePath("/handoff");
  revalidatePath("/inventory/ops");
  redirect("/today?saved=stock-count&count="+created.id+(hasDiscrepancy?"&reconcile=1":""));
}

export async function reportBarIncident(formData: FormData) {
  const severity = String(formData.get("severity") ?? "NORMAL");
  const area = String(formData.get("area") ?? "BARRA").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (
    !note ||
    !["NORMAL", "IMPORTANT", "URGENT"].includes(severity)
  ) {
    redirect("/today?error=incident");
  }

  const { user, employee } = await getCurrentEmployee();
  if (!employee.homeStoreId) redirect("/today?error=store");

  await assertEmployeePermission(
    employee.id,
    "checklist.execute",
    employee.homeStoreId,
  );

  const db = getDb();
  const [created] = await db
    .insert(operationalEvents)
    .values({
      organizationId: employee.organizationId,
      storeId: employee.homeStoreId,
      employeeId: employee.id,
      eventType: "BAR_INCIDENT",
      severity,
      itemNameSnapshot: area,
      note,
    })
    .returning({ id: operationalEvents.id });

  await db.insert(auditEvents).values({
    organizationId: employee.organizationId,
    storeId: employee.homeStoreId,
    actorUserId: user.id,
    actorEmployeeId: employee.id,
    action: "BAR_INCIDENT_REPORTED",
    entityType: "operational_event",
    entityId: created.id,
    afterData: { severity, area, note },
  });

  revalidatePath("/today");
  revalidatePath("/handoff");
  revalidatePath("/admin/decision-center");
  redirect("/today?saved=incident");
}
