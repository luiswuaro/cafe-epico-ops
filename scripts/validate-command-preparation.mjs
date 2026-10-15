import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

// La transición se ejecuta como TypeScript transpiliado, no sólo inspección
// de código fuente: cubrir clics directos, repetidos y tardíos.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"epico-command-time-"));
function readTypeScript(file){
  const source=fs.readFileSync(file,"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  const dest=path.join(directory,path.basename(file)+".cjs");
  fs.writeFileSync(dest,compiled);
  return createRequire(import.meta.url)(dest);
}
try{
  const {commandPreparationDecision:decide}=readTypeScript("src/domain/pos/command-preparation.ts");
  const {deriveCommandTimeline,durationSeconds}=readTypeScript("src/domain/pos/command-timing.ts");
  const direct=decide("SENT","READY",[]);
  assert.equal(direct.shouldRecord,true);
  assert.equal(direct.preparingSkipped,true,"Lista directa implica preparación completa");
  assert.equal(decide("READY","PREPARING",[]).shouldRecord,false,
    "No regresar a Preparando tras Lista");
  assert.equal(decide("READY","READY",[]).shouldRecord,false,
    "No repetir eventos de Lista");
  assert.equal(decide("PREPARING","PREPARING",[]).shouldRecord,false);
  assert.deepEqual(decide("PREPARING","READY",[]),
    {shouldRecord:true,preparingSkipped:false});
  assert.equal(decide("PAID","PREPARING",["READY"]).shouldRecord,false,
    "Un ticket ya cobrado y listo tampoco puede regresar a Preparando");
  assert.equal(decide("PAID","READY",["READY"]).shouldRecord,false);
  assert.equal(decide("PAID","READY",[]).shouldRecord,true,
    "El pedido cobrado para llevar sí puede quedar listo");
  assert.equal(decide("PAID","PREPARING",[]).shouldRecord,true,
    "Cobrar antes de preparar no bloquea la fase de barra");
  assert.equal(decide("PAID","READY",["PREPARING"]).preparingSkipped,false);
  assert.equal(decide("SENT","PREPARING",["READY"]).shouldRecord,false,
    "Resistir una interfaz desactualizada mientras otro operador pulsa Lista");

  const t=(s)=>new Date("2026-10-14T12:"+s+"Z");
  const lines=[{createdAt:t("00:00"),expectedConsumption:{roundId:"INITIAL"}}];
  const printed={action:"POS_COMMAND_PRINT_ACKNOWLEDGED",
    createdAt:t("00:10"),afterData:{roundId:"INITIAL"}};
  const ready={action:"POS_COMMAND_STATUS_CHANGED",
    createdAt:t("03:40"),afterData:{roundId:"INITIAL",status:"READY",preparingSkipped:true}};
  const instant=deriveCommandTimeline(t("00:00"),lines,[ready,printed]);
  assert.equal(instant.preparingAt,null,"No inventar hora de Preparando");
  assert.equal(instant.printAckAt?.getTime(),t("00:10").getTime());
  assert.equal(instant.readyAt?.getTime(),t("03:40").getTime());
  assert.equal(durationSeconds(instant.printAckAt,instant.readyAt),210,
    "Tiempo total 3:30 desde impresión a Lista sin paso Preparando");
  const manual=deriveCommandTimeline(t("00:00"),lines,[
    printed,{action:"POS_COMMAND_STATUS_CHANGED",createdAt:t("01:00"),
      afterData:{roundId:"INITIAL",status:"PREPARING"}},ready]);
  assert.equal(durationSeconds(manual.printAckAt,manual.readyAt),210,
    "Preparando es opcional para tiempo total");
  assert.equal(durationSeconds(manual.preparingAt,manual.readyAt),160);
  const missingPrint=deriveCommandTimeline(t("00:00"),lines,[ready]);
  assert.equal(missingPrint.printAckAt,null,"Sin acuse no atribuir impresión falsa");

  const action=fs.readFileSync("app/(employee)/pos/actions.ts","utf8");
  const board=fs.readFileSync("app/(employee)/pos/orders/page.tsx","utf8");
  const clock=fs.readFileSync("app/(employee)/pos/orders/command-timer.tsx","utf8");
  const report=fs.readFileSync("app/(employee)/pos/performance/page.tsx","utf8");
  assert.ok(action.includes('commandStatusSchema = z.enum(["PREPARING", "READY"])'),
    "No permitir revertir a SENT desde el formulario");
  assert.ok(action.includes("commandPreparationDecision("));
  assert.ok(action.includes("if(!decision.shouldRecord)return;"));
  assert.ok(action.includes("pg_advisory_xact_lock"),"Bloqueo por sucursal para clics concurrentes");
  assert.ok(action.includes("preparingSkipped:decision.preparingSkipped"));
  assert.ok(action.includes('if(current.status!=="PAID")'),
    "Preparación no modifica estado financiero de cuentas pagadas");
  assert.ok(board.includes('const isReady=order.status==="READY"||Boolean(order.readyAt)'));
  assert.ok(board.includes('!isReady&&!isPreparing'));
  assert.ok(board.includes('!isReady && ('));
  assert.ok(clock.includes("Preparación total:"));
  assert.ok(clock.includes("since(printAckAt,readyAt)"));
  assert.ok(clock.includes("readyAt&&!preparingAt"));
  assert.ok(report.includes("preparación completada aunque no tenga hora de inicio manual"));
  console.log("COMANDAS: PASS (impresión→lista, Lista directa, estado terminal, PAID, tiempos sin inventar)");
}finally{
  fs.rmSync(directory,{recursive:true,force:true});
}
