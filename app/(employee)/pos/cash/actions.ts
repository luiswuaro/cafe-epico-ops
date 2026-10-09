"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentEmployee } from "@/src/infrastructure/auth/current-employee";
import { assertEmployeePermission } from "@/src/infrastructure/auth/permissions";
import { getDb } from "@/src/infrastructure/db/client";
import { auditEvents, posCashMovements, posCashSessions } from "@/src/infrastructure/db/schema";

const moneySchema = z.coerce.number().finite().min(0).max(1_000_000);
function parseMoney(value:FormDataEntryValue|null){
  if(value==null||String(value).trim()==="")throw new Error("Escribe un importe válido.");
  const amount=moneySchema.parse(value);
  if(Math.abs(Math.round(amount*100)-amount*100)>0.00001)throw new Error("Usa máximo dos decimales.");
  return amount;
}

export async function openCashSession(formData: FormData) {
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.cash.manage",employee.homeStoreId);
  const openingCash=parseMoney(formData.get("openingCash"));
  const note=String(formData.get("note")??"").trim()||null;
  const db=getDb();
  const opened=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [existing]=await tx.select({id:posCashSessions.id}).from(posCashSessions)
      .where(and(eq(posCashSessions.organizationId,employee.organizationId),
        eq(posCashSessions.storeId,employee.homeStoreId!),
        eq(posCashSessions.status,"OPEN"))).limit(1);
    if(existing)return false;
    const [session]=await tx.insert(posCashSessions).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      openingCash:openingCash.toFixed(2),openedByEmployeeId:employee.id,
    }).returning({id:posCashSessions.id});
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_CASH_SESSION_OPENED",entityType:"pos_cash_session",entityId:session.id,
      afterData:{openingCash,note},
    });
    return true;
  });
  redirect("/pos/cash?"+(opened?"opened=1":"alreadyOpen=1"));
}

export async function recordCashMovement(formData: FormData) {
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.cash.manage",employee.homeStoreId);
  const type=z.enum(["CASH_IN","CASH_OUT"]).parse(String(formData.get("movementType")??""));
  const amount=parseMoney(formData.get("amount"));
  const note=String(formData.get("note")??"").trim();
  if(amount<=0||note.length<3||note.length>500)throw new Error("Monto y motivo inválidos.");
  const db=getDb();
  await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [session]=await tx.select().from(posCashSessions).where(and(
      eq(posCashSessions.organizationId,employee.organizationId),
      eq(posCashSessions.storeId,employee.homeStoreId!),eq(posCashSessions.status,"OPEN"),
    )).for("update").limit(1);
    if(!session)throw new Error("No hay caja abierta.");
    const signed=type==="CASH_OUT"?-amount:amount;
    const [movement]=await tx.insert(posCashMovements).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      sessionId:session.id,employeeId:employee.id,movementType:type,
      amount:signed.toFixed(2),note,
    }).returning({id:posCashMovements.id});
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_CASH_MOVEMENT_RECORDED",
      entityType:"pos_cash_movement",entityId:movement.id,
      afterData:{type,amount:signed,note,sessionId:session.id},
    });
  });
  redirect("/pos/cash?movement=1");
}

export async function closeCashSession(formData: FormData) {
  const {user,employee}=await getCurrentEmployee();
  if(!employee.homeStoreId)throw new Error("Sin sucursal asignada");
  await assertEmployeePermission(employee.id,"pos.cash.manage",employee.homeStoreId);
  const countedCash=parseMoney(formData.get("countedCash"));
  const closingNote=String(formData.get("closingNote")??"").trim()||null;
  const db=getDb();
  await db.transaction(async tx=>{
    // Serializa cobros LIVE, arqueos y entradas/salidas sobre la misma caja.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.homeStoreId!}))`);
    const [session]=await tx.select().from(posCashSessions).where(and(
      eq(posCashSessions.organizationId,employee.organizationId),
      eq(posCashSessions.storeId,employee.homeStoreId!),
      eq(posCashSessions.status,"OPEN"),
    )).for("update").limit(1);
    if(!session)throw new Error("No hay caja abierta para cerrar.");
    const [total]=await tx.select({
      amount:sql<string>`coalesce(sum(${posCashMovements.amount}),0)::text`,
    }).from(posCashMovements).where(eq(posCashMovements.sessionId,session.id));
    const expectedCash=Math.round((Number(session.openingCash)+Number(total?.amount||0))*100)/100;
    const difference=Math.round((countedCash-expectedCash)*100)/100;
    const now=new Date();
    const [updated]=await tx.update(posCashSessions).set({
      status:"CLOSED",countedCash:countedCash.toFixed(2),
      expectedCashSnapshot:expectedCash.toFixed(2),difference:difference.toFixed(2),
      closedByEmployeeId:employee.id,closedAt:now,closingNote,updatedAt:now,
    }).where(and(eq(posCashSessions.id,session.id),eq(posCashSessions.status,"OPEN")))
      .returning({id:posCashSessions.id});
    if(!updated)throw new Error("La caja se modificó; vuelve a revisar el arqueo.");
    await tx.insert(auditEvents).values({
      organizationId:employee.organizationId,storeId:employee.homeStoreId!,
      actorUserId:user.id,actorEmployeeId:employee.id,
      action:"POS_CASH_SESSION_CLOSED",entityType:"pos_cash_session",entityId:session.id,
      afterData:{openingCash:Number(session.openingCash),expectedCash,countedCash,difference,closingNote},
    });
  });
  redirect("/pos/cash?closed=1");
}
