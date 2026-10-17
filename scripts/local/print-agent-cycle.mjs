import {printAgentPayload} from "./print-agent-format.mjs";

/**
 * One bounded cycle of QUEUE -> CLAIM -> BRIDGE -> ACK.
 * All side effects are injected: tests use fake API/printer while production
 * agent delegates to the existing Postgres-backed OPS endpoints and ESC/POS.
 * A failed bridge ACK does NOT cause an automatic retry.
 */
export async function runPrintJobs({
 jobs,template,stationId,printer,availability,api,bridge,sleep,
 now=()=>Date.now(),cutGap=12,log=()=>{},format=printAgentPayload,
}){
 if(!Array.isArray(jobs))throw Error("Invalid print feed.");
 const statuses=[];
 const seen=new Set();
 for(const job of jobs){
   if(!job||typeof job!=="object"||typeof job.key!=="string"||seen.has(job.key))continue;
   seen.add(job.key);
   const kitchen=job.kind==="KITCHEN"||job.kind==="VOID";
   const target=kitchen?printer.kitchen:printer.ticket;
   const healthKey=target.port+":"+target.token;
   if(!availability.has(healthKey)||!availability.get(healthKey)){
     statuses.push({key:job.key,status:"BRIDGE_OFFLINE"});
     continue;
   }
   const created=new Date(job.createdAt).getTime();
   if(!Number.isFinite(created)||now()-created>300000||created>now()+60000){
     statuses.push({key:job.key,status:"STALE"});
     continue;
   }
   // Render BEFORE obtaining a claim. Malformed jobs do not consume an
   // immutable printing lease, so they can be reviewed without losing paper.
   const payload=await format(job,template);
   const claim=await api("CLAIM",{jobKey:job.key,stationId});
   if(claim?.claimed!==true){
     statuses.push({key:job.key,status:"ALREADY_CLAIMED"});
     continue;
   }
   try{
     const printedOn=await bridge(target.port,target.token,payload);
     // Mark first: a timing failure must not trigger a second print.
     await api("FINISH",{jobKey:job.key,stationId,
       outcome:"DONE",details:printedOn});
     if(job.kind==="KITCHEN"){
       try{
         await api("ACK",{orderId:job.orderId,
           roundId:job.roundId||"INITIAL",printer:printedOn});
       }catch{
         log("Métrica de comanda no disponible; el papel no se reenvía.");
       }
     }
     statuses.push({key:job.key,status:"DONE"});
     if(cutGap>0)await sleep(cutGap*1000);
   }catch{
     // The spooler may have accepted the paper before connection was lost.
     // A second POST here would be unsafe; fail closed and review manually.
     try{
       await api("FINISH",{jobKey:job.key,stationId,outcome:"FAILED",
         details:"ACK no confirmado; revisar papel manualmente"});
     }catch{log("Trabajo reclamado con resultado ambiguo; revisión manual.");}
     statuses.push({key:job.key,status:"UNKNOWN_OUTPUT"});
   }
 }
 return statuses;
}
