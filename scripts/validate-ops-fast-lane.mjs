import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-fast-lane-"));
try{
  const pure=fs.readFileSync("src/domain/pos/command-timing.ts","utf8");
  fs.writeFileSync(path.join(dir,"timing.cjs"),ts.transpileModule(pure,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {deriveCommandTimeline,durationSeconds,durationText}=
    createRequire(path.join(dir,"test.cjs"))("./timing.cjs");
  const t=sec=>new Date(Date.UTC(2026,9,11,12,0,sec));
  const order=t(0),first=[{createdAt:t(0),expectedConsumption:{roundId:"INITIAL"}}];
  const mk=(action,sec,afterData)=>({action,createdAt:t(sec),afterData});
  const print=mk("POS_COMMAND_PRINT_ACKNOWLEDGED",5,{roundId:"INITIAL"});
  const preparing=mk("POS_COMMAND_STATUS_CHANGED",9,{status:"PREPARING"});
  const ready=mk("POS_COMMAND_STATUS_CHANGED",30,{status:"READY"});
  let result=deriveCommandTimeline(order,first,[ready,print,preparing]);
  assert.equal(durationSeconds(result.printAckAt,result.readyAt),25);
  assert.equal(durationSeconds(result.preparingAt,result.readyAt),21);
  assert.equal(durationText(125),"2:05");
  result=deriveCommandTimeline(order,first,[ready]);
  assert.equal(result.printAckAt,null,"Sin acuse del puente, no inventar impresión");
  assert.equal(result.readyAt.getTime(),t(30).getTime());

  // Una nueva ronda no debe heredar el reloj de la ronda anterior.
  const second=[...first,{createdAt:t(45),expectedConsumption:{roundId:"RONDA_2"}}];
  result=deriveCommandTimeline(order,second,[print,preparing,ready]);
  assert.equal(result.roundId,"RONDA_2");
  assert.equal(result.printAckAt,null);
  assert.equal(result.readyAt,null);
  const roundPrint=mk("POS_COMMAND_PRINT_ACKNOWLEDGED",46,{roundId:"RONDA_2"});
  const roundReady=mk("POS_COMMAND_STATUS_CHANGED",59,{status:"READY"});
  result=deriveCommandTimeline(order,second,[print,ready,roundPrint,roundReady]);
  assert.equal(durationSeconds(result.printAckAt,result.readyAt),13);

  const sale=fs.readFileSync("src/application/pos/live.ts","utf8");
  assert.ok(sale.includes("POS_LIVE_INVENTORY_SHORTAGE_AUTO_RECORDED"));
  assert.ok(sale.includes("automaticForAllOperators:true"));
  assert.ok(!sale.includes("if(stockShortages.length&&!input.allowStockShortage)"));
  assert.ok(sale.includes("theoreticalQuantity:\"0\""));
  const checkout=fs.readFileSync("app/(employee)/pos/checkout/payment-form.tsx","utf8");
  assert.ok(!checkout.includes("allowStockShortage"));
  const pos=fs.readFileSync("app/(employee)/pos/pos-client.tsx","utf8");
  assert.ok(pos.includes("Seleccionar mesa en un toque"));
  assert.ok(pos.includes('event.key==="F2"'));
  console.log("OPS fast lane: stock + tiempos + shortcuts PASS");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
