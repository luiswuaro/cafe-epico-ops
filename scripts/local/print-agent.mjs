/**
 * Windows/Node 22 worker: impresión en segundo plano SIN navegador.
 * Exclusivo de entorno QA local, nunca Vercel ni producción.
 * La DB mantiene CLAIM/DONE/FAILED; NO se reenvía si el ACK es ambiguo.
 */
import {randomUUID} from "node:crypto";
import {runPrintJobs} from "./print-agent-cycle.mjs";
import {printAgentRasterPayload} from "./print-agent-raster.mjs";

const env=process.env;
function guard(){
 if(env.OPS_LOCAL_FIRST!=="true"||env.OPS_QA_MODE!=="true"||
    env.DEFAULT_ORGANIZATION_SLUG!=="cafe-epico-qa"||
    env.DEFAULT_STORE_CODE!=="QA-TEPEXI"||
    env.POS_LIVE_ENABLED==="true"||env.VERCEL||env.VERCEL_ENV)
   throw Error("El agente sólo se permite en OPS local QA.");
 if(env.NEXT_PUBLIC_OPS_LOCAL_PRINT_AGENT_ENABLED!=="true")
   throw Error("Debes habilitar explícitamente el modo de agente sin navegador.");
 if(!env.OPS_LOCAL_PRINT_AGENT_TOKEN||env.OPS_LOCAL_PRINT_AGENT_TOKEN.length<32||
    env.OPS_LOCAL_PRINT_AGENT_TOKEN.includes("REEMPLAZAR"))
   throw Error("Falta token local del agente (32+ caracteres).");
 if(!/^[0-9a-f-]{36}$/i.test(env.OPS_LOCAL_PRINT_AGENT_USER_ID??""))
   throw Error("Falta UUID del usuario Auth exclusivo del agente QA.");
 if(!env.OPS_LOCAL_TICKET_PRINTER_TOKEN||
    env.OPS_LOCAL_TICKET_PRINTER_TOKEN.includes("REEMPLAZAR"))
   throw Error("Falta token local de la impresora.");
}
const agentApi="http://127.0.0.1:3000/api/local-print-agent";
const printerUrl=port=>"http://127.0.0.1:"+port;
const timeout=ms=>AbortSignal.timeout(ms);
async function api(op,input={}){
 const res=await fetch(agentApi,{method:"POST",
   headers:{"Authorization":"Bearer "+env.OPS_LOCAL_PRINT_AGENT_TOKEN,
     "Content-Type":"application/json"},
   body:JSON.stringify({op,...input}),signal:timeout(10000),cache:"no-store"});
 if(!res.ok)throw Error("Servidor de impresión OPS: HTTP "+res.status);
 return res.json();
}
async function bridge(port,token,payload){
 const base=printerUrl(port);
 const status=await fetch(base+"/status",{
   headers:{"X-Cafe-Epico-Token":token},signal:timeout(3500)});
 const reported=await status.json().catch(()=>({}));
 if(!status.ok||reported.ok!==true||reported.rasterBands!==true)
   throw Error("Puente ESC/POS no disponible o sin soporte de bandas.");
 if(!payload)return reported.printer||"POS-58";
 const response=await fetch(base+"/print",{method:"POST",
   headers:{"X-Cafe-Epico-Token":token,"Content-Type":"application/json"},
   body:JSON.stringify(payload),signal:timeout(18000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok!==true)throw Error("El puente no confirmó el trabajo.");
 return data.printer||reported.printer||"POS-58";
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 guard();
 const stationId=randomUUID();
 const cutGap=Number(env.OPS_LOCAL_PRINT_GAP_SECONDS??12);
 if(!Number.isInteger(cutGap)||cutGap<0||cutGap>30)
   throw Error("OPS_LOCAL_PRINT_GAP_SECONDS debe ser entero de 0 a 30.");
 const since=new Date().toISOString(); // No reimprime trabajos anteriores al arranque.
 let lastVersion="";
 let lastHeartbeat=0;
 let delay=0;
 let errors=0;
 console.log("Agente QA local activo; impresión automática sin navegador.");
 console.log("No se recuperan comandas anteriores al inicio; revisar pendientes manualmente.");
 for(;;){
  try{
   if(delay)await sleep(delay);
   // La comprobación ocurre ANTES de reclamar. Si una impresora no responde,
   // no inmoviliza ni marca como fallidos los pedidos.
   const ticketToken=env.OPS_LOCAL_TICKET_PRINTER_TOKEN;
   const kitchenToken=env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN&&
     !env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN.includes("REEMPLAZAR")
       ?env.OPS_LOCAL_KITCHEN_PRINTER_TOKEN:ticketToken;
   const ticketPort=Number(env.OPS_LOCAL_TICKET_PRINTER_PORT||9137);
   // Una impresora secundaria puede compartir token con la principal.
   // El puerto elegido, no la igualdad del token, decide el destino.
   const separatePort=env.OPS_LOCAL_KITCHEN_PRINTER_PORT;
   const kitchenPort=separatePort
     ?Number(separatePort)
     :(kitchenToken===ticketToken?ticketPort:9138);
   if(![ticketPort,kitchenPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535))
     throw Error("Puertos de impresora inválidos.");
   const availability=new Map();
   for(const [port,token] of [[ticketPort,ticketToken],[kitchenPort,kitchenToken]]){
     const key=port+":"+token;
     if(availability.has(key))continue;
     try{availability.set(key,await bridge(port,token,null))}
     catch{availability.set(key,null)}
   }
   // Ventana móvil como la estación del navegador: el servidor rechaza
   // cursores de más de 72 h, aunque la PC permanezca encendida semanas.
   // Nunca bajar el cursor por debajo de la activación actual del agente.
   const pollSince=new Date(Math.max(new Date(since).getTime(),
     Date.now()-24*60*60*1000)).toISOString();
   if(Date.now()-lastHeartbeat>=20000){
     await api("HEARTBEAT",{stationId,since:pollSince,
       bridgeReady:[...availability.values()].some(Boolean)});
     lastHeartbeat=Date.now();
   }
   const result=await api("POLL",{since:pollSince,lastVersion});
   const jobs=Array.isArray(result.jobs)?result.jobs:[];
   // Sólo saltar feed cuando el servidor confirmó cero trabajos.
   lastVersion=jobs.length?"":
     typeof result.version==="string"?result.version:"";
   if(jobs.length&&!result.template)throw Error("Falta formato del ticket.");
   const statuses=await runPrintJobs({
     jobs,template:result.template??{},stationId,availability,
     printer:{
       kitchen:{port:kitchenPort,token:kitchenToken},
       ticket:{port:ticketPort,token:ticketToken},
     },
     api,bridge,sleep,cutGap,
     ...(env.OPS_LOCAL_PRINT_RASTER_ENABLED==="true"?{format:printAgentRasterPayload}:{}),
     log:message=>console.warn(message),
   });
   for(const status of statuses){
     if(status.status==="DONE")
       console.log("Enviada: "+status.key.slice(0,32));
     if(status.status==="UNKNOWN_OUTPUT")
       console.warn("Resultado ambiguo; revisión manual: "+status.key.slice(0,32));
   }
   errors=0;delay=4000;
  }catch{
   errors++;
   delay=Math.min(60000,1000*2**Math.min(errors,6));
   console.warn("OPS local o puente temporalmente no disponible. Reintento espaciado: "+delay+" ms.");
  }
 }
}
main().catch(error=>{
 console.error("No se inició el agente QA: "+(error?.message||"configuración inválida"));
 process.exitCode=1;
});
