/**
 * Diagnóstico de pulso exclusivo para OPS local QA.
 * Consultas de solo lectura, sin reclamar trabajos ni enviar impresiones.
 * La operación API inexistente sirve solamente para comprobar autenticación.
 * No muestra tokens, contraseñas ni UUID.
 */
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
const env=process.env;
async function main(){
  const guard=validateLocalQaConfig(env);
  if(!guard.ok || env.DEFAULT_STORE_CODE!=="QA-TEPEXI" ||
     env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED!=="true")
    throw Error("Configuración no corresponde a OPS QA aislado.");
  const url=new URL(env.DATABASE_URL);
  if(!["localhost","127.0.0.1","::1"].includes(url.hostname))
    throw Error("La base no apunta a PostgreSQL local.");
  const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
  try{
    const query="SELECT current_database() AS db_name, "+
      "(SELECT count(*)::int FROM public.pos_print_station_status) AS pulse_count, "+
      "(SELECT bridge_ready FROM public.pos_print_station_status ORDER BY last_seen DESC LIMIT 1) AS bridge_ready, "+
      "(SELECT round(extract(epoch from (now()-last_seen)))::int FROM public.pos_print_station_status "+
      "ORDER BY last_seen DESC LIMIT 1) AS seconds_since_pulse";
    const r=await db.unsafe(query);
    if(r.length!==1)throw Error("Consulta inesperada.");
    const org=await db.unsafe("SELECT slug FROM public.organizations");
    const stores=await db.unsafe("SELECT code FROM public.stores");
    if(org.length!==1||org[0].slug!=="cafe-epico-qa"||
       stores.length!==1||stores[0].code!=="QA-TEPEXI")
      throw Error("La base no es exclusiva de QA.");
    console.log("BASE REAL OPS QA: "+r[0].db_name);
    console.log("REGISTROS DE PULSO: "+r[0].pulse_count);
    console.log("PUENTE EN ÚLTIMO PULSO: "+
      (r[0].bridge_ready===null?"SIN REGISTRO":r[0].bridge_ready?"LISTO":"NO LISTO"));
    console.log("SEGUNDOS DESDE ÚLTIMO PULSO: "+
      (r[0].seconds_since_pulse===null?"SIN REGISTRO":r[0].seconds_since_pulse));
  }finally{await db.end({timeout:3});}
  const api="http://127.0.0.1:3000/api/local-print-agent";
  try{
    const res=await fetch(api,{method:"GET",signal:AbortSignal.timeout(5000),cache:"no-store"});
    console.log("RUTA NEXT.JS: HTTP "+res.status+
      (res.status===405?" (ruta disponible, GET no permitido)":""));
  }catch{
    console.log("RUTA NEXT.JS: NO RESPONDE en 127.0.0.1:3000");
    return;
  }
  const token=env.OPS_LOCAL_PRINT_AGENT_TOKEN;
  if(typeof token!=="string"||token.length<32)throw Error("Token agente QA ausente.");
  // Operación inexistente: no puede ejecutar ninguna rama de escritura.
  try{
    const res=await fetch(api,{method:"POST",cache:"no-store",
      headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({op:"QA_READONLY_DIAGNOSTIC_UNSUPPORTED"}),
      signal:AbortSignal.timeout(10000)});
    const body=await res.json().catch(()=>({}));
    if(res.status===400&&body?.error==="Operación rechazada")
      console.log("AUTENTICACIÓN AGENTE: PASS (identidad y permiso QA; operación inexistente rechazada).");
    else if(res.status===403)
      console.log("AUTENTICACIÓN AGENTE: HTTP 403 (token, usuario o permisos rechazados).");
    else
      console.log("AUTENTICACIÓN AGENTE: HTTP "+res.status+" (revisar servidor QA).");
  }catch{
    console.log("AUTENTICACIÓN AGENTE: servidor no respondió.");
  }
  console.log("FIN: consultas de solo lectura; no se enviaron trabajos ni se modificó PostgreSQL.");
}
main().catch(()=>{
  console.error("BLOQUEADO: no se pudo concluir la comprobación de OPS QA.");
  process.exitCode=1;
});