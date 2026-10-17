import {createHash,timingSafeEqual} from "node:crypto";

/** Comparación uniforme: nunca registrar secretos o devolver detalles de token. */
export function validLocalPrintToken(provided:string|null,secret:string|undefined):boolean{
 if(!secret||secret.length<32||!provided?.startsWith("Bearer "))return false;
 const input=provided.slice(7);
 if(input.length<32||input.length>512)return false;
 const a=createHash("sha256").update(input,"utf8").digest();
 const b=createHash("sha256").update(secret,"utf8").digest();
 return timingSafeEqual(a,b);
}
