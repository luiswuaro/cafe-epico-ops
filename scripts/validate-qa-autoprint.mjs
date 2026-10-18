/** Validación offline de aislamiento y deduplicación QA. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runPrintJobs} from "./local/print-agent-cycle.mjs";

const hub=readFileSync("app/(employee)/pos/printer/hub-actions.ts","utf8");
const fixture=readFileSync("scripts/local/test-qa-autoprint-once.mjs","utf8");
for(const fragment of [
 'process.env.OPS_QA_MODE==="true"',
 'process.env.POS_LIVE_ENABLED==="false"',
 'process.env.DEFAULT_ORGANIZATION_SLUG==="cafe-epico-qa"',
 'process.env.DEFAULT_STORE_CODE==="QA-TEPEXI"',
 "o.mode='SHADOW' AND o.folio LIKE 'QA-PRINT-%'",
 "o.status='SENT'","o.paid_at IS NULL AND o.total=0",
 "o.inventory_effect_applied=false AND o.loyalty_effect_applied=false",
 'eq(posOrders.mode,"SHADOW")','eq(posOrders.total,"0.00")',
 'eq(posOrders.inventoryEffectApplied,false)',
 'eq(posOrders.loyaltyEffectApplied,false)',
 'eq(posOrders.status,"SENT")','isNull(posOrders.paidAt)',
 'printOrderScopeDrizzle())).limit(1)'
])assert.ok(hub.includes(fragment),"Falta aislamiento: "+fragment);
assert.equal(hub.split("and $"+ "{printable}").length-1,3,
 "Tres sondas deben filtrar por la misma regla");
assert.ok(hub.includes('eq(posOrders.mode,"LIVE")'));
assert.ok(fixture.includes('open(marker,"wx",0o600)'));
assert.ok(fixture.includes("db.begin(async tx=>"));
assert.ok(fixture.includes("'SHADOW','SENT'"));
assert.ok(fixture.includes("0,0,$7,false,false"));
assert.ok(!fixture.includes("insert into public.pos_payments"));
assert.ok(!fixture.includes("insert into public.pos_loyalty_entries"));

const now=Date.now();
const job={key:"KITCHEN:00000000-0000-4000-8000-000000000001:QA_ONE_SHOT",
 orderId:"00000000-0000-4000-8000-000000000001",roundId:"QA_ONE_SHOT",
 kind:"KITCHEN",createdAt:new Date(now).toISOString(),
 slip:{folio:"QA-PRINT-TEST",table:"MESA PRUEBA",orderNote:"NO PREPARAR",
 lines:[{name:"COMANDA DE PRUEBA",quantity:1,
 category:"CALIENTES",note:"NO COBRAR",serviceMode:"DINE_IN"}]}};
let printed=0,done=0;
const claimed=new Set();
const api=async(op,input)=>{
 if(op==="CLAIM"){
  if(claimed.has(input.jobKey))return {claimed:false};
  claimed.add(input.jobKey);return {claimed:true};
 }
 if(op==="FINISH"){assert.equal(input.outcome,"DONE");done++;return{ok:true};}
 if(op==="ACK")return{ok:true};
 throw Error("Operación inesperada");
};
const config={jobs:[job],template:{lineWidthChars:32},stationId:"test",
 printer:{kitchen:{port:9137,token:"fake"},ticket:{port:9137,token:"fake"}},
 availability:new Map([["9137:fake","POS-58"]]),api,
 bridge:async()=>{printed++;return "POS-58";},
 sleep:async()=>{},now:()=>now,cutGap:0};
assert.deepEqual((await runPrintJobs(config)).map(x=>x.status),["DONE"]);
assert.deepEqual((await runPrintJobs(config)).map(x=>x.status),["ALREADY_CLAIMED"]);
assert.equal(printed,1);assert.equal(done,1);
assert.deepEqual((await runPrintJobs({...config,
 jobs:[{...job,key:job.key+"X",createdAt:new Date(now-360000).toISOString()}]
})).map(x=>x.status),["STALE"]);
assert.deepEqual((await runPrintJobs({...config,availability:new Map()}))
 .map(x=>x.status),["BRIDGE_OFFLINE"]);
assert.equal(printed,1);
console.log("PASS: excepción QA únicamente para SHADOW $0, sin pagos ni puntos.");
console.log("PASS: un solo CLAIM/DONE; duplicado, vencido o puente offline bloqueados.");
console.log("PASS: sin impresora física ni acceso a PostgreSQL.");
