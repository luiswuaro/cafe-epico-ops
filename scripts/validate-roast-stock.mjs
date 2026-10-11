import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";
const root=process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-roast-stock-"));
try{
 const code=fs.readFileSync(path.join(root,"src/domain/roasting/stock-ledger.ts"),"utf8");
 fs.writeFileSync(path.join(dir,"stock.cjs"),ts.transpileModule(code,{compilerOptions:{
   target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
 }}).outputText);
 const {grams,transferProjection,mxRoastDate,roastDayBounds,roastingItemSku}=
   createRequire(path.join(dir,"run.cjs"))("./stock.cjs");
 assert.equal(grams("342.000"),342);
 assert.equal(grams("0.001"),0.001);
 for(const v of ["0","-1","342.0001","NaN","Infinity",""])assert.throws(()=>grams(v));
 assert.deepEqual(transferProjection(4277.3,380,"342"),{
   quantityG:342,bagAfterG:3935.3,barAfterG:722,
 });
 assert.deepEqual(transferProjection(500,380,"150.5"),{
   quantityG:150.5,bagAfterG:349.5,barAfterG:530.5,
 });
 assert.throws(()=>transferProjection(20,380,"21"),/disponibles/);
 assert.equal(mxRoastDate(new Date("2026-10-10T21:16:00Z")),"2026-10-10");
 const {start,end}=roastDayBounds("2026-10-10");
 assert.equal(start.toISOString(),"2026-10-10T06:00:00.000Z");
 assert.equal(end.toISOString(),"2026-10-11T06:00:00.000Z");
 assert.throws(()=>roastDayBounds("2026-02-30"),/inválida/);
 assert.equal(roastingItemSku("10cc7dbe-aeb8-4b58-ba75-be23e2b9b464"),"ROAST-10CC7DBE");
 const actions=fs.readFileSync(path.join(root,"app/(admin)/admin/roasting/inventory-actions.ts"),"utf8");
 const importActions=fs.readFileSync(path.join(root,"app/(admin)/admin/roasting/import-actions.ts"),"utf8");
 const panel=fs.readFileSync(path.join(root,"app/(admin)/admin/roasting/roast-bag-stock-panel.tsx"),"utf8");
 const form=fs.readFileSync(path.join(root,"app/(admin)/admin/roasting/roast-bag-transfer-form.tsx"),"utf8");
 assert.match(actions,/process\.env\.VERCEL_ENV==="preview"/);
 assert.match(actions,/requireProductionWrite\(\)/);
 assert.match(actions,/externalId:batch\.id\+":ROASTED"/);
 assert.match(actions,/if\(!greenIds\.has\(b\.id\)\)/);
 assert.match(actions,/movementType:"PRODUCTION_OUTPUT"/);
 assert.match(actions,/movementType:"TRANSFER_OUT"/);
 assert.match(actions,/movementType:"TRANSFER_IN"/);
 assert.match(actions,/eq\(inventoryItems\.sku,"CAFE-ESPRESSO"\)/);
 assert.match(actions,/projected\.barAfterG\.toFixed\(3\)/);
 assert.match(actions,/pg_advisory_xact_lock/);
 assert.match(importActions,/roastedStockPosted=true/);
 assert.match(importActions,/externalId:createdBatch\.id\+":ROASTED"/);
 assert.match(importActions,/expectedSku="ROAST-"/);
 assert.match(panel,/process\.env\.VERCEL_ENV==="preview"/);
 assert.match(panel,/Registro de café tostado|Registrar producción/);
 assert.match(panel,/operationId=\{randomUUID\(\)\}/);
 assert.match(form,/name="quantityG"/);
 assert.match(form,/type="number"/);
 assert.match(form,/transferProjection\(/);
 assert.match(form,/disabled=\{!possible\}/);
 console.log("ROAST STOCK: PASS (mixed bag, 380+342=722, idempotence, warehouse, preview write guard)");
}finally{fs.rmSync(dir,{recursive:true,force:true});}
