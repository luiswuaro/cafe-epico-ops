/**
 * Windows/Node 22 worker: impresión en segundo plano SIN navegador.
 * Exclusivo de entorno QA local, nunca Vercel ni producción.
 * La DB mantiene CLAIM/DONE/FAILED; NO se reenvía si el ACK es ambiguo.
 */
import {randomUUID} from "node:crypto";
import {printAgentPayload} from "./print-agent-format.mjs";

const env=process.env;
function guard(){
 if(env.OPS_LOCAL_FIRST!=="true"||env.OPS_QA_MODE!=="true"||
    env.POS_LIVE_ENABLED==="true"||env.VERCEL||env.VERCEL_ENV)
   throw Error("El agente sólo se permite en OPS local QA.");
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
   const kitchenPort=kitchenToken===ticketToken?ticketPort:
     Number(env.OPS_LOCAL_KITCHEN_PRINTER_PORT||9138);
   if(![ticketPort,kitchenPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535))
     throw Error("Puertos de impresora inválidos.");
   const availability=new Map();
   for(const [port,token] of [[ticketPort,ticketToken],[kitchenPort,kitchenToken]]){
     const key=port+":"+token;
     if(availability.has(key))continue;
     try{availability.set(key,await bridge(port,token,null))}
     catch{availability.set(key,null)}
   }
   if(Date.now()-lastHeartbeat>=20000){
     await api("HEARTBEAT",{stationId,since,
       bridgeReady:[...availability.values()].some(Boolean)});
     lastHeartbeat=Date.now();
   }
   const result=await api("POLL",{since,lastVersion});
   const jobs=Array.isArray(result.jobs)?result.jobs:[];
   // Sólo saltar feed cuando el servidor confirmó cero trabajos.
   lastVersion=jobs.length?"":
     typeof result.version==="string"?result.version:"";
   if(jobs.length&&!result.template)throw Error("Falta formato del ticket.");
   for(const job of jobs){
     const kitchen=job.kind==="KITCHEN"||job.kind==="VOID";
     const port=kitchen?kitchenPort:ticketPort;
     const token=kitchen?kitchenToken:ticketToken;
     if(!availability.get(port+":"+token))continue;
     const created=new Date(job.createdAt).getTime();
     if(!Number.isFinite(created)||Date.now()-created>300000||
        created>Date.now()+60000)continue;
     const payload=printAgentPayload(job,result.template);
     const claimed=await api("CLAIM",{jobKey:job.key,stationId});
     if(claimed.claimed!==true)continue;
     try{
       const printer=await bridge(port,token,payload);
       // Se marca DONE antes de cualquier métrica; un fallo de métrica
       // no provoca una segunda impresión.
       await api("FINISH",{jobKey:job.key,stationId,outcome:"DONE",details:printer});
       if(kitchen&&job.kind==="KITCHEN"){
         try{await api("ACK",{orderId:job.orderId,
           roundId:job.roundId||"INITIAL",printer})}catch{
           console.warn("Comanda enviada; métrica de impresión no registrada.");
         }
       }
       console.log("Enviada: "+job.kind+" "+job.key.slice(0,22));
       await sleep(12000); // POS-58: tiempo para separar el papel sin guillotina.
     }catch{
       // El spooler puede haber aceptado el trabajo antes del timeout. Nunca
       // reenviar automáticamente. Si FINISH falla, CLAIM persiste sin reintento.
       try{await api("FINISH",{jobKey:job.key,stationId,
         outcome:"FAILED",details:"ACK no confirmado; revisar papel manualmente"})}
       catch{console.warn("Trabajo reclamado; pendiente de conciliación manual.");}
     }
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
