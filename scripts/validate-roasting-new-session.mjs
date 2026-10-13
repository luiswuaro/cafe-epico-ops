import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import ts from "typescript";

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"epico-roast-session-"));
try{
  const source=fs.readFileSync("src/domain/roasting/session-window.ts","utf8");
  fs.writeFileSync(path.join(temp,"session-window.cjs"),ts.transpileModule(source,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText);
  const {batchBelongsToRoastSession,plannedRoastCharges}=
    createRequire(path.join(temp,"runner.cjs"))("./session-window.cjs");
  const lot="MARSELLESA",oldDay="2026-10-10",today="2026-10-13";
  const old=Array.from({length:13},(_,i)=>({
    coffeeLotId:lot,roastedAt:new Date(Date.UTC(2026,9,10,16,i*15)).toISOString(),
    greenWeightG:i===12?200:400,
  }));
  const newDate=new Date("2026-10-13T20:00:00.000Z").toISOString();
  const newBatch={coffeeLotId:lot,roastedAt:"2026-10-13T20:15:00.000Z"};
  assert.equal(old.filter(b=>batchBelongsToRoastSession(b,{lotId:lot,startDate:oldDay})).length,13);
  assert.equal(old.filter(b=>batchBelongsToRoastSession(b,{
    lotId:lot,startDate:today,sessionStartedAt:newDate,
  })).length,0,"Los trece del 10/oct nunca se suman en la sesión nueva");
  assert.equal(batchBelongsToRoastSession(newBatch,{
    lotId:lot,startDate:today,sessionStartedAt:newDate,
  }),true);
  assert.equal(batchBelongsToRoastSession({...newBatch,roastedAt:"2026-10-13T19:59:59.000Z"},{
    lotId:lot,startDate:today,sessionStartedAt:newDate,
  }),false,"Sesiones distintas del mismo día se separan por hora exacta");
  assert.equal(batchBelongsToRoastSession(newBatch,{
    lotId:lot,startDate:oldDay,sessionEndedAt:newDate,
  }),false,"Los planes archivados no deben mezclar nuevas sesiones");
  assert.equal(batchBelongsToRoastSession({...newBatch,coffeeLotId:"OTHER"},{
    lotId:lot,startDate:today,
  }),false);
  const plan10=plannedRoastCharges(10000,400,[]);
  assert.equal(plan10.length,25);
  assert.equal(plan10.reduce((sum,n)=>sum+n,0),10000);
  assert.deepEqual(plannedRoastCharges(10000,400,[400,400]).length,23);
  assert.deepEqual(plannedRoastCharges(5000,400,[]).at(-1),200);
  assert.deepEqual(plannedRoastCharges(10000,400,Array(25).fill(400)),[]);
  assert.deepEqual(plannedRoastCharges(26000,400,[]),[]);

  const ui=fs.readFileSync("app/(admin)/admin/roasting/session-planner.tsx","utf8");
  assert.match(ui,/Nueva sesión de tueste/);
  assert.match(ui,/setDraftWeights\(\{\}\)/,"La sesión nueva debe limpiar los borradores previos");
  assert.match(ui,/HISTORY_KEY/);
  assert.match(ui,/batchBelongsToRoastSession/);
  assert.match(ui,/sessionStartedAt:now\.toISOString\(\)/);
  assert.match(ui,/target:"10000"/);
  assert.match(ui,/config\.sessionId\s*\?config\.sessionId/);
  assert.match(ui,/No se|no modifica inventarios|no modifica inventarios ni los batches/i);
  console.log("Roast session: PASS (13 históricos, 25 nuevos, límites de hora, historial, sin cambios de stock)");
}finally{fs.rmSync(temp,{recursive:true,force:true});}
