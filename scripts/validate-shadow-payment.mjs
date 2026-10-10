import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";
const root=process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-shadow-pay-"));
try{
  const source=fs.readFileSync(path.join(root,"src/domain/pos/shadow-payment.ts"),"utf8");
  fs.writeFileSync(path.join(dir,"pay.cjs"),ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {shadowPaymentFields:cash}=createRequire(path.join(dir,"entry.cjs"))("./pay.cjs");
  assert.deepEqual(cash("CASH",60),{tenderedAmount:"60.00",changeAmount:"0.00"});
  assert.deepEqual(cash("CASH",60,"100"),{tenderedAmount:"100.00",changeAmount:"40.00"});
  assert.deepEqual(cash("CASH",65.35,"100"),{tenderedAmount:"100.00",changeAmount:"34.65"});
  assert.deepEqual(cash("CARD",60),{tenderedAmount:null,changeAmount:null});
  assert.deepEqual(cash("TRANSFER",60),{tenderedAmount:null,changeAmount:null});
  assert.throws(()=>cash("CASH",60,"59.99"),/debe cubrir/);
  assert.throws(()=>cash("CASH",60,"NaN"),/debe cubrir/);
  assert.throws(()=>cash("CASH",60,"60.001"),/hasta dos decimales/);
  assert.throws(()=>cash("CASH",-1),/inválido/);

  const actions=fs.readFileSync(path.join(root,"app/(employee)/pos/actions.ts"),"utf8");
  const direct=actions.split("async function createShadowOrder(")[1]?.split("/** Inline error response")[0];
  const afterSave=actions.split("export async function payShadowCommand(")[1]?.split("export async function createPosCustomer")[0];
  assert.ok(direct&&afterSave,"Las dos rutas de pago espejo deben existir.");
  for(const block of [direct,afterSave]){
    assert.match(block,/shadowPaymentFields\(/);
    assert.match(block,/\.\.\.cash/);
    assert.doesNotMatch(block,/insert\(posCashMovements\)/,
      "El espejo no puede crear movimientos de caja reales");
    assert.doesNotMatch(block,/getOpenCashSession\(/,
      "La prueba de pagos no necesita sesión de caja LIVE");
  }
  assert.match(afterSave,/eq\(posOrders\.mode,"SHADOW"\)/);
  assert.match(afterSave,/No se pudo cobrar la cuenta simulada|El pago simulado no se confirmó/);
  const board=fs.readFileSync(path.join(root,"app/(employee)/pos/orders/page.tsx"),"utf8");
  assert.match(board,/Prueba ESPEJO: no cobra dinero real, no mueve caja/);
  console.log("POS pago ESPEJO: PASS (efectivo, transferencia, tarjeta, sin caja LIVE y guardia concurrente)");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
