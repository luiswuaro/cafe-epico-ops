/**
 * ÚNICA prueba física de comanda QA en POS-58 (58 mm).
 * Sin venta, pedido, cobro, inventario, puntos o escritura PostgreSQL.
 * Por defecto, --check NO imprime. --print-once emite una solicitud
 * como máximo; se crea un marcador local ANTES de llamar a /print.
 *
 * node --env-file=.env.local scripts/local/test-qa-pos58-paper-once.mjs --check
 * node --env-file=.env.local scripts/local/test-qa-pos58-paper-once.mjs --print-once
 */
import {open,mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import postgres from "postgres";
import {validateLocalQaConfig} from "./guard-qa-config.mjs";
import {printAgentPayload} from "./print-agent-format.mjs";

const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const markerRel=".local/qa-pos58-physical-smoke-test.once";
const marker=join(root,markerRel);
const port=9137;
const printer="POS-58 (copy 1)";
const env=process.env;
function blocked(){throw Error("BLOQUEADO: preflight QA no superado. Sin enviar papel.");}
async function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||!["--check","--print-once"].includes(mode))blocked();
 if(!validateLocalQaConfig(env).ok||
    env.OPS_QA_MODE!=="true"||env.POS_LIVE_ENABLED!=="false"||
    env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa"||
    env.DEFAULT_STORE_CODE!=="QA-TEPEXI"||
    Number(env.OPS_LOCAL_TICKET_PRINTER_PORT)!==port)blocked();
 const token=env.OPS_LOCAL_TICKET_PRINTER_TOKEN;
 if(typeof token!=="string"||token.length<32||token.includes("REEMPLAZAR"))blocked();
 try{
   execFileSync("git",["check-ignore","-q","--",markerRel],
     {cwd:root,stdio:"ignore"});
 }catch{blocked();}
 // Confirmar antes de siquiera consultar el puente que seguimos en DB QA.
 const db=postgres(env.DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
 try{
   const orgs=await db.unsafe("SELECT id, slug FROM public.organizations");
   const stores=await db.unsafe("SELECT organization_id, code FROM public.stores");
   if(orgs.length!==1||orgs[0].slug!=="cafe-epico-qa"||
      stores.length!==1||stores[0].code!=="QA-TEPEXI"||
      stores[0].organization_id!==orgs[0].id)blocked();
 }finally{await db.end({timeout:3});}
 const url="http://127.0.0.1:"+port;
 const headers={"X-Cafe-Epico-Token":token};
 const status=await fetch(url+"/status",{
   headers,signal:AbortSignal.timeout(3500),cache:"no-store"
 });
 const data=await status.json().catch(()=>({}));
 if(!status.ok||data.ok!==true||data.mode!=="RAW_ESC_POS"||
    data.rasterBands!==true||data.printer!==printer)blocked();
 console.log("PASS: DB aislada QA, POS-58 (copy 1), 58 mm, puente loopback autenticado.");
 console.log("PASS: sin ventas LIVE y sin acceso a inventario, caja ni datos comerciales.");
 if(mode==="--check"){
   console.log("PASS: modo SOLO CONSULTA. No se imprimió ni creó trabajo.");
   console.log("Para imprimir una única comanda ficticia: ejecutar con --print-once.");
   return;
 }
 await mkdir(join(root,".local"),{recursive:true});
 // Bloqueo 'wx': un segundo intento, incluso concurrente, queda rechazado.
 // Si el ACK es ambiguo, NO reenvía papel automáticamente.
 const lock=await open(marker,"wx",0o600).catch(()=>blocked());
 try{
  await lock.writeFile("QA one-shot local printer smoke test; reserved before POST.\n");
  await lock.sync();
 }finally{await lock.close();}
 const job={
  kind:"KITCHEN",
  slip:{
   folio:"QA-SOLO-PRUEBA",
   table:"MESA PRUEBA",
   orderNote:"NO COBRAR - NO PREPARAR",
   lines:[{
    quantity:1,name:"COMANDA DE PRUEBA",
    category:"CALIENTES",serviceMode:"DINE_IN",
    note:"NO PREPARAR NI COBRAR",
   }],
  },
 };
 const payload=printAgentPayload(job,{lineWidthChars:32});
 if(!Array.isArray(payload.lines)||payload.lines.length>25||
    payload.cut!==false||payload.feed!==2)blocked();
 console.log("Marcador de única emisión registrado en .local (ignorado por Git).");
 console.log("Enviando UNA comanda ficticia a POS-58, sin operaciones en OPS.");
 let res;
 try{
  res=await fetch(url+"/print",{
   method:"POST",
   headers:{...headers,"Content-Type":"application/json"},
   body:JSON.stringify(payload),
   signal:AbortSignal.timeout(18000),
   cache:"no-store",
  });
 }catch{
  console.log("RESULTADO AMBIGUO: no reenviar. Revisar físicamente la impresora.");
  process.exitCode=2;
  return;
 }
 const reply=await res.json().catch(()=>({}));
 if(!res.ok||reply.ok!==true){
  console.log("NO CONFIRMADO: puente HTTP "+res.status+
    ". No reintentar hasta revisar papel y marcador.");
  process.exitCode=2;
  return;
 }
 console.log("PASS: puente aceptó exactamente un POST de prueba para POS-58.");
 console.log("CONFIRMACIÓN FINAL PENDIENTE: verificar que salió UNA sola comanda en papel.");
 console.log("No se registró ningún ticket, cobro, movimiento de inventario ni pedido OPS.");
}
main().catch(()=>{
 console.error("BLOQUEADO: consulta o prueba QA no completada. No reintentar impresiones a ciegas.");
 process.exitCode=1;
});