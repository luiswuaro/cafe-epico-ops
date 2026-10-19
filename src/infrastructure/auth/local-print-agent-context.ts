import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";
import type {employees} from "@/src/infrastructure/db/schema";

/** Contexto exclusivo de llamadas internas después de validar el token del
 * proceso de impresión Y la cuenta/permiso en PostgreSQL. Nunca se acepta
 * esta identidad desde JSON, headers de usuario, ni acciones públicas.
 */
export type LocalPrintAgentIdentity={
 user:{id:string;email:null};
 employee:typeof employees.$inferSelect;
};
const localPrintAgentContext=new AsyncLocalStorage<LocalPrintAgentIdentity>();

export function withLocalPrintAgent<T>(
 actor:LocalPrintAgentIdentity,
 task:()=>Promise<T>,
):Promise<T>{
 return localPrintAgentContext.run(actor,task);
}
export function localPrintAgentIdentity():LocalPrintAgentIdentity|undefined{
 return localPrintAgentContext.getStore();
}
