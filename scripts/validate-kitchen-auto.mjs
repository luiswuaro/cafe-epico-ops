import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-kitchen-auto-"));
try{
  const root=process.cwd();
  const source=fs.readFileSync(path.join(root,"src/domain/pos/kitchen-auto-policy.ts"),"utf8");
  fs.writeFileSync(path.join(dir,"policy.cjs"),ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {autoKitchenModes:modes}=createRequire(path.join(dir,"run.cjs"))("./policy.cjs");
  assert.deepEqual(modes("saved",false,true),["TAKEAWAY"]);
  assert.deepEqual(modes("saved",true,false),["DINE_IN"]);
  assert.deepEqual(modes("saved",true,true),["DINE_IN","TAKEAWAY"]);
  assert.deepEqual(modes("saved",false,false),[]);
  assert.deepEqual(modes("paid-direct",false,true),["TAKEAWAY"]);
  assert.deepEqual(modes("paid-direct",true,false),["DINE_IN"]);
  assert.deepEqual(modes("paid-direct",true,true),["DINE_IN","TAKEAWAY"]);
  assert.deepEqual(modes("paid",true,true),[]);
  assert.deepEqual(modes("paid",false,true),[]);
  const read=p=>fs.readFileSync(path.join(root,p),"utf8");
  const auto=read("app/(employee)/pos/orders/auto-kitchen-print.tsx");
  const receipt=read("app/(employee)/pos/receipt/[id]/page.tsx");
  const actions=read("app/(employee)/pos/actions.ts");
  const split=read("app/(employee)/pos/orders/[id]/split/actions.ts");
  const direct=read("app/(employee)/pos/live-actions.ts");
  const orders=read("app/(employee)/pos/orders/page.tsx");
  const extraRound=read("app/(employee)/pos/orders/live-actions.ts");
  const printer=read("app/(employee)/pos/printer/printer-client.tsx");

  // The only valid receipt-side trigger is a confirmed direct payment.
  assert.match(receipt,/query\.autoKitchen==="paid-direct"/);
  assert.doesNotMatch(receipt,/query\.autoKitchen==="paid"/);
  assert.match(direct,/autoKitchen=paid-direct/);
  assert.doesNotMatch(actions,/autoKitchen=paid/);
  assert.doesNotMatch(split,/autoKitchen=paid/);

  // Saved tickets and additional rounds already receive a saved-only trigger.
  assert.match(actions,/autoKitchen=saved/);
  assert.match(orders,/event="saved"/);
  assert.match(extraRound,/autoKitchen=saved/);
  assert.match(auto,/autoKitchenModes\(event,autoDineIn,autoTakeaway\)/);
  assert.match(auto,/event==="saved"\?"latest":"all"/);
  assert.match(auto,/AUTO_KITCHEN_ATTEMPT_PREFIX/);
  assert.match(printer,/Para llevar · al guardar o al cobrar directo/);
  // El usuario comprobó físicamente la impresión ESPEJO en preview.
  // En producción debe funcionar también si el navegador habilita impresión.
  assert.doesNotMatch(actions,/process\.env\.VERCEL_ENV==="preview"\?"&autoKitchen=saved":""/);
  assert.match(actions,/redirect\("\/pos\/orders\?created="\+orderId\+\s*"&autoKitchen=saved"\)/);
  assert.match(orders,/order\.mode==="LIVE"\|\|order\.mode==="SHADOW"/);
  assert.doesNotMatch(orders,/previewShadowPrint&&order\.mode==="SHADOW"/);
  const printable=read("app/(employee)/pos/orders/[id]/kitchen/page.tsx");
  assert.match(printable,/state\.order\.mode!=="LIVE"&&state\.order\.mode!=="SHADOW"/);
  assert.doesNotMatch(printable,/process\.env\.VERCEL_ENV/);
  assert.match(orders,/Imprimir comanda/);
  console.log("POS kitchen print: PASS (guardado, cobro directo, sin segunda impresión en pago posterior)");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
