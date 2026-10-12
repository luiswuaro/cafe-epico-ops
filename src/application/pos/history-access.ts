import "server-only";
import {createHash,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {and,eq,gte} from "drizzle-orm";
import {getDb} from "@/src/infrastructure/db/client";
import {auditEvents} from "@/src/infrastructure/db/schema";
import {employeeHasPermission} from "@/src/infrastructure/auth/permissions";
import type {getCurrentEmployee} from "@/src/infrastructure/auth/current-employee";

type Employee=Awaited<ReturnType<typeof getCurrentEmployee>>["employee"];
export const HISTORY_COOKIE="epico_history_grant_v1";
export const HISTORY_GRANT_MINUTES=15;
export const HISTORY_CODE_MINUTES=5;
export const HISTORY_ACCESS_PATHS=["/pos/tickets","/pos/cash/history"] as const;
export type HistoryPath=typeof HISTORY_ACCESS_PATHS[number];
export function safeHistoryPath(value:unknown):HistoryPath{
 return value==="/pos/cash/history"?"/pos/cash/history":"/pos/tickets";
}
export function grantDigest(value:string){
 return createHash("sha256").update(value,"utf8").digest("hex");
}
export function constantHexMatch(a:string,b:string):boolean{
 if(!/^[a-f0-9]{64}$/.test(a)||!/^[a-f0-9]{64}$/.test(b))return false;
 return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
/** Revalidación desde servidor en CADA lectura. La cookie sólo contiene
 * un token aleatorio de 256 bits; la base almacena su huella digital.
 * Ningún permiso de venta o caja habilita por sí mismo el historial.
 */
export async function hasPosHistoryAccess(employee:Employee):Promise<boolean>{
 if(!employee.homeStoreId)return false;
 if(await employeeHasPermission(employee.id,"admin.access",employee.homeStoreId))
   return true;
 const value=(await cookies()).get(HISTORY_COOKIE)?.value??"";
 const match=/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
 if(!match)return false;
 const [row]=await getDb().select({
  afterData:auditEvents.afterData,createdAt:auditEvents.createdAt,
 }).from(auditEvents).where(and(
  eq(auditEvents.id,match[1]),
  eq(auditEvents.organizationId,employee.organizationId),
  eq(auditEvents.storeId,employee.homeStoreId),
  eq(auditEvents.actorEmployeeId,employee.id),
  eq(auditEvents.action,"POS_HISTORY_ACCESS_GRANTED"),
  eq(auditEvents.entityType,"pos_history_grant"),
  gte(auditEvents.createdAt,new Date(Date.now()-HISTORY_GRANT_MINUTES*60_000)),
 )).limit(1);
 if(!row)return false;
 const data=row.afterData;
 return typeof data?.digest==="string"&&
   constantHexMatch(data.digest,grantDigest(match[2])) &&
   typeof data.expiresAt==="string"&&Date.parse(data.expiresAt)>Date.now();
}
