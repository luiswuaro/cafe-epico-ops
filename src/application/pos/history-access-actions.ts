"use server";

import {randomBytes,randomInt,randomUUID,scryptSync} from "node:crypto";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {and,eq,gte,inArray,sql} from "drizzle-orm";
import {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";
import {assertEmployeePermission} from "@/src/infrastructure/auth/permissions";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents} from "@/src/infrastructure/db/schema";
import {assertNoPreviewMutation} from "@/src/shared/preview-guard";
import {HISTORY_CODE_MINUTES,HISTORY_COOKIE,HISTORY_GRANT_MINUTES,
  safeHistoryPath,grantDigest,constantHexMatch} from "./history-access";

export type HistoryCodeState={
 code:string|null;expiresAt:string|null;error:string|null;
};
export async function createOwnerHistoryCode(
 _previous:HistoryCodeState,
 _data:FormData,
):Promise<HistoryCodeState>{
 assertNoPreviewMutation();
 const {user,employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sucursal no configurada");
 await assertEmployeePermission(employee.id,"admin.access",employee.homeStoreId);
 const code=randomInt(0,100_000_000).toString().padStart(8,"0");
 const salt=randomBytes(16).toString("hex");
 const digest=scryptSync(code,salt,32).toString("hex");
 const expiresAt=new Date(Date.now()+HISTORY_CODE_MINUTES*60_000);
 await getDb().insert(auditEvents).values({
  organizationId:employee.organizationId,storeId:employee.homeStoreId,
  actorUserId:user.id,actorEmployeeId:employee.id,
  action:"POS_HISTORY_CODE_CREATED",entityType:"pos_history_code",
  entityId:randomUUID(),
  afterData:{salt,digest,expiresAt:expiresAt.toISOString(),useLimit:1,
    purpose:"POS_TICKETS_AND_CASH_HISTORY"},
 });
 return {code,expiresAt:expiresAt.toISOString(),error:null};
}

/** El resultado queda ligado al navegador del empleado, por 15 minutos;
 * no se otorgan nuevos roles ni permisos permanentes.
 */
export async function unlockPosHistory(form:FormData){
 assertNoPreviewMutation();
 const {user,employee}=await getCurrentEmployee();
 if(!employee.homeStoreId)throw new Error("Sucursal no configurada");
 await assertEmployeePermission(employee.id,"pos.sell",employee.homeStoreId);
 const destination=safeHistoryPath(form.get("destination"));
 const code=String(form.get("code")??"").trim();
 const db=getDb(),storeId=employee.homeStoreId;
 const now=Date.now();
 const recent=new Date(now-15*60_000);
 const outcome=await db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.organizationId+":"+storeId+":pos_history"}))`);
  const recentAttempts=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(
   eq(auditEvents.organizationId,employee.organizationId),
   eq(auditEvents.storeId,storeId),
   eq(auditEvents.actorEmployeeId,employee.id),
   eq(auditEvents.action,"POS_HISTORY_CODE_REJECTED"),
   gte(auditEvents.createdAt,recent),
  )).limit(6);
  if(recentAttempts.length>=5)return {status:"rate" as const};
  const codes=await tx.select({
    id:auditEvents.id,entityId:auditEvents.entityId,afterData:auditEvents.afterData,
  }).from(auditEvents).where(and(
    eq(auditEvents.organizationId,employee.organizationId),
    eq(auditEvents.storeId,storeId),
    eq(auditEvents.action,"POS_HISTORY_CODE_CREATED"),
    eq(auditEvents.entityType,"pos_history_code"),
    gte(auditEvents.createdAt,new Date(now-HISTORY_CODE_MINUTES*60_000)),
  )).limit(100);
  const used=await tx.select({entityId:auditEvents.entityId})
   .from(auditEvents).where(and(
     eq(auditEvents.organizationId,employee.organizationId),
     eq(auditEvents.storeId,storeId),
     eq(auditEvents.action,"POS_HISTORY_CODE_USED"),
     inArray(auditEvents.entityId,codes.length?codes.map(c=>c.entityId):["no-keys"]),
   ));
  const usedIds=new Set(used.map(x=>x.entityId));
  const valid=/^\d{8}$/.test(code)&&codes.find(row=>{
   if(usedIds.has(row.entityId))return false;
   const data=row.afterData;
   if(typeof data?.salt!=="string"||typeof data?.digest!=="string"||
     typeof data?.expiresAt!=="string"||Date.parse(data.expiresAt)<=now)return false;
   return constantHexMatch(data.digest,scryptSync(code,data.salt,32).toString("hex"));
  });
  if(!valid){
   await tx.insert(auditEvents).values({
    organizationId:employee.organizationId,storeId,actorUserId:user.id,
    actorEmployeeId:employee.id,action:"POS_HISTORY_CODE_REJECTED",
    entityType:"pos_history_attempt",entityId:employee.id,
    afterData:{destination,reason:"INVALID_OR_EXPIRED"},
   });
   return {status:"bad" as const};
  }
  const token=randomBytes(32).toString("base64url");
  const grantExpires=new Date(now+HISTORY_GRANT_MINUTES*60_000);
  const [grant]=await tx.insert(auditEvents).values({
   organizationId:employee.organizationId,storeId,
   actorUserId:user.id,actorEmployeeId:employee.id,
   action:"POS_HISTORY_ACCESS_GRANTED",entityType:"pos_history_grant",
   entityId:employee.id,
   afterData:{digest:grantDigest(token),expiresAt:grantExpires.toISOString(),
      sourceCodeId:valid.entityId,destination},
  }).returning({id:auditEvents.id});
  await tx.insert(auditEvents).values({
   organizationId:employee.organizationId,storeId,actorUserId:user.id,
   actorEmployeeId:employee.id,action:"POS_HISTORY_CODE_USED",
   entityType:"pos_history_code",entityId:valid.entityId,
   afterData:{grantId:grant.id,destination},
  });
  return {status:"ok" as const,cookie:grant.id+"."+token,expires:grantExpires};
 });
 if(outcome.status!=="ok")
   redirect(destination+"?lockError="+(outcome.status==="rate"?"rate":"invalid"));
 (await cookies()).set(HISTORY_COOKIE,outcome.cookie,{
   httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",
   path:"/pos",expires:outcome.expires,
 });
 redirect(destination);
}
