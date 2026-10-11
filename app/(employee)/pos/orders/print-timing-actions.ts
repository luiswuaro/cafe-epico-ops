"use server";

import {and,eq,sql} from "drizzle-orm";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents,posOrders} from "@/src/infrastructure/db/schema";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";

/** Registrar solamente tras respuesta OK del puente de impresión.
 * Los reintentos de la misma ronda conservan el primer acuse (métrica repetible).
 */
export async function acknowledgeKitchenPrint(input:{
  orderId:string;roundId:string;printer:string;
}){
  const parsed=z.object({
    orderId:z.string().uuid(),
    roundId:z.string().min(1).max(120),
    printer:z.string().trim().min(1).max(150),
  }).parse(input);
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal");
  await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
  const db=getDb();
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [order]=await tx.select({id:posOrders.id}).from(posOrders).where(and(
      eq(posOrders.id,parsed.orderId),
      eq(posOrders.organizationId,employee.organizationId),
      eq(posOrders.storeId,employee.homeStoreId!),
    )).limit(1);
    if(!order)throw new Error("La comanda no pertenece a esta sucursal.");
    const [recorded]=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(
      eq(auditEvents.organizationId,employee.organizationId),
      eq(auditEvents.entityType,"pos_order"),eq(auditEvents.entityId,order.id),
      eq(auditEvents.action,"POS_COMMAND_PRINT_ACKNOWLEDGED"),
      sql`${auditEvents.afterData}->>'roundId' = ${parsed.roundId}`,
    )).limit(1);
    if(recorded)return;
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_COMMAND_PRINT_ACKNOWLEDGED",entityType:"pos_order",
      entityId:order.id,
      afterData:{roundId:parsed.roundId,printer:parsed.printer,
        signal:"ESC_POS_BRIDGE_OK",physicalPaperConfirmed:false},
    });
  });
  revalidatePath("/pos/orders");
}
