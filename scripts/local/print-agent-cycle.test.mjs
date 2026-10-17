import assert from "node:assert/strict";
import {test} from "node:test";
import {runPrintJobs} from "./print-agent-cycle.mjs";

const now=Date.now();
const kitchen={
 key:"KITCHEN:11111111-1111-4111-8111-111111111111:INITIAL",
 kind:"KITCHEN",orderId:"11111111-1111-4111-8111-111111111111",
 roundId:"INITIAL",createdAt:new Date(now).toISOString(),
 slip:{folio:"QA-0001",table:"MESA QA",lines:[
   {quantity:1,name:"Café español",serviceMode:"TAKEAWAY",note:"Sin hielo"}]},
};
const ticket={
 key:"RECEIPT:22222222-2222-4222-8222-222222222222",
 kind:"RECEIPT",orderId:"22222222-2222-4222-8222-222222222222",
 createdAt:new Date(now).toISOString(),
 ticket:{folio:"QA-0002",date:"2026-10-17",employee:"QA",
   service:"Para llevar",items:[{quantity:1,name:"Latte",total:"$50"}],
   total:"$50",payment:"Transferencia $50",status:"PAID",
   pointsEarned:"2.50",pointsBalance:"22.50"},
};
function harness(opts={}){
 const operations=[];const sent=[];const sleeps=[];const claimed=new Set();
 const active=new Map([["9137:TICKET","Cajera"],["9138:KITCHEN","Barra"]]);
 if(opts.offline)active.set(opts.offline,null);
 const api=async(op,value)=>{
   operations.push({op,value});
   if(op==="CLAIM"){
     if(claimed.has(value.jobKey)||opts.denyClaim){
       return {claimed:false};
     }
     claimed.add(value.jobKey);return {claimed:true};
   }
   if(op==="ACK"&&opts.failMetric)throw Error("Timing unavailable");
   if(op==="FINISH"&&opts.failFinish)throw Error("No database ACK");
   return {ok:true};
 };
 const bridge=async(port,token,payload)=>{
   sent.push({port,token,payload});
   if(opts.failBridge)throw Error("Printer lost connection after spool");
   return port===9138?"Barra":"Caja";
 };
 return {operations,sent,sleeps,claimed,active,api,bridge,
   options:{
     template:{lineWidthChars:32},
     stationId:"33333333-3333-4333-8333-333333333333",
     availability:active,
     printer:{kitchen:{port:9138,token:"KITCHEN"},
       ticket:{port:9137,token:"TICKET"}},
     api,bridge,sleep:async(ms)=>sleeps.push(ms),cutGap:0,
     now:()=>now,
   }};
}
test("2 pedidos en 2 estaciones: una impresión por clave, DONE y ACK de comanda",async()=>{
 const h=harness();
 const statuses=await runPrintJobs({...h.options,jobs:[kitchen,ticket,kitchen]});
 assert.deepEqual(statuses.map(x=>x.status),["DONE","DONE"]);
 assert.deepEqual(h.sent.map(s=>s.port),[9138,9137]);
 assert.equal(h.operations.filter(x=>x.op==="CLAIM").length,2);
 assert.equal(h.operations.filter(x=>x.op==="FINISH"&&x.value.outcome==="DONE").length,2);
 assert.equal(h.operations.filter(x=>x.op==="ACK").length,1);
 const printed=h.sent[1].payload.lines.map(x=>x.text).join(" ");
 assert.match(printed,/22.50/);
 assert.match(printed,/Transferencia/);
});
test("sin puente saludable, no se reclama ni imprime",async()=>{
 const h=harness({offline:"9138:KITCHEN"});
 const statuses=await runPrintJobs({...h.options,jobs:[kitchen]});
 assert.equal(statuses[0].status,"BRIDGE_OFFLINE");
 assert.equal(h.operations.length,0);assert.equal(h.sent.length,0);
});
test("falla de spooler tras CLAIM: FAILED, nunca segundo POST",async()=>{
 const h=harness({failBridge:true});
 const statuses=await runPrintJobs({...h.options,jobs:[kitchen]});
 assert.equal(statuses[0].status,"UNKNOWN_OUTPUT");
 assert.equal(h.sent.length,1);
 assert.deepEqual(h.operations.map(x=>x.op),["CLAIM","FINISH"]);
 assert.equal(h.operations.at(-1).value.outcome,"FAILED");
});
test("ACK del servidor perdido tras papel: no repite impresión automática",async()=>{
 const h=harness({failFinish:true});
 const statuses=await runPrintJobs({...h.options,jobs:[ticket]});
 assert.equal(statuses[0].status,"UNKNOWN_OUTPUT");
 assert.equal(h.sent.length,1);
 assert.equal(h.operations.filter(x=>x.op==="FINISH").length,2);
 assert.equal(h.operations.filter(x=>x.op==="CLAIM").length,1);
});
test("métrica de comanda caída no provoca reimpresión",async()=>{
 const h=harness({failMetric:true});
 const statuses=await runPrintJobs({...h.options,jobs:[kitchen]});
 assert.equal(statuses[0].status,"DONE");
 assert.equal(h.sent.length,1);
 assert.equal(h.operations.filter(x=>x.op==="FINISH").length,1);
});
test("trabajo reclamado por otra estación nunca llega a impresora",async()=>{
 const h=harness({denyClaim:true});
 const statuses=await runPrintJobs({...h.options,jobs:[ticket]});
 assert.equal(statuses[0].status,"ALREADY_CLAIMED");
 assert.equal(h.sent.length,0);
});
test("trabajo vencido no se reclama y no se imprime",async()=>{
 const h=harness();
 const expired={...kitchen,createdAt:new Date(now-301_000).toISOString()};
 const statuses=await runPrintJobs({...h.options,jobs:[expired]});
 assert.equal(statuses[0].status,"STALE");
 assert.equal(h.operations.length,0);
});
test("comanda malformada se rechaza antes de tocar la cola",async()=>{
 const h=harness();
 await assert.rejects(runPrintJobs({...h.options,
   jobs:[{...kitchen,slip:{lines:[]}}]}),/Comanda sin líneas/);
 assert.equal(h.operations.length,0);assert.equal(h.sent.length,0);
});

test("si falla el render raster no se reclama ni imprime papel",async()=>{
 const h=harness();
 await assert.rejects(runPrintJobs({...h.options,jobs:[kitchen],
   format:async()=>{throw Error("GDI no disponible")}}),/GDI no disponible/);
 assert.equal(h.operations.length,0);
 assert.equal(h.sent.length,0);
});
test("bitmap Unicode se entrega al puente como un único trabajo físico",async()=>{
 const h=harness();
 const bitmap={raster:{dataBase64:Buffer.alloc(48*40).toString("base64"),
   width:384,height:40,align:"center"},feed:2,cut:false};
 const result=await runPrintJobs({...h.options,jobs:[kitchen],
   format:async()=>bitmap});
 assert.equal(result[0].status,"DONE");
 assert.equal(h.sent.length,1);
 assert.deepEqual(h.sent[0].payload,bitmap);
 assert.equal(h.operations.filter(x=>x.op==="CLAIM").length,1);
});
