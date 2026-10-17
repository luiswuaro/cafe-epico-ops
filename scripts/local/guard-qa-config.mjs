import net from "node:net";
import {pathToFileURL} from "node:url";

/**
 * Bloqueo preventivo: un piloto LAN JAMÁS debe reutilizar DB o Auth productivos.
 * No imprime credenciales ni conexión. Valida solo endpoints de QA local.
 * Este archivo es comprobación para el comando start-qa.ps1; no cambia la app de Vercel.
 */
function privateIp(host){
  if(host==="localhost"||host==="127.0.0.1"||host==="::1")return true;
  if(net.isIP(host)!==4)return false;
  const octets=host.split(".").map(Number);
  if(octets[0]===10)return true;
  if(octets[0]===192&&octets[1]===168)return true;
  if(octets[0]===172&&octets[1]>=16&&octets[1]<=31)return true;
  return false;
}
export function validateLocalQaConfig(env){
  const errors=[];
  const parse=(name)=>{
    const value=env[name];
    if(!value||value.includes("REEMPLAZAR")||value.includes("CHANGE_ME")){
      errors.push(name+": sin configurar");return null;
    }
    try{return new URL(value)}catch{errors.push(name+": URL inválida");return null}
  };
  const db=parse("DATABASE_URL");
  if(db){
    if(!["postgres:","postgresql:"].includes(db.protocol))errors.push("DATABASE_URL: debe ser PostgreSQL");
    if(!["localhost","127.0.0.1","::1"].includes(db.hostname))
      errors.push("DATABASE_URL: usar solo PostgreSQL de la PC (loopback)");
  }
  const auth=parse("NEXT_PUBLIC_SUPABASE_URL");
  if(auth){
    if(!privateIp(auth.hostname))errors.push("Auth: la URL debe ser una IP privada de la red local");
    if(auth.protocol!=="https:")errors.push("Auth: HTTPS es obligatorio para celulares");
  }
  const origin=parse("APP_ORIGIN");
  if(origin){
    if(!privateIp(origin.hostname))errors.push("APP_ORIGIN: debe ser privado de la LAN");
    if(origin.protocol!=="https:")errors.push("APP_ORIGIN: HTTPS es obligatorio en LAN");
  }
  if(!env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY.includes("REEMPLAZAR"))
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: falta clave pública de Auth LOCAL");
  if(env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa")
    errors.push("DEFAULT_ORGANIZATION_SLUG: usar cafe-epico-qa en el piloto");
  if(env.OPS_QA_MODE!=="true"||env.POS_LIVE_ENABLED==="true")
    errors.push("Piloto: OPS_QA_MODE=true y POS_LIVE_ENABLED=false");
  if(env.OPS_LOCAL_FIRST!=="true")errors.push("OPS_LOCAL_FIRST=true obligatorio");
  if(env.VERCEL||env.VERCEL_ENV)errors.push("El piloto no se ejecuta en Vercel");
  return {ok:errors.length===0,errors};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=validateLocalQaConfig(process.env);
  if(!result.ok){
    for(const error of result.errors)console.error("BLOQUEADO: "+error);
    process.exitCode=2;
  }else{
    console.log("PASS: piloto solo con PostgreSQL loopback + Auth HTTPS privado, organización QA, ventas LIVE deshabilitadas.");
  }
}
