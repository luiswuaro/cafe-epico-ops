import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {createRequire} from "node:module";
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"epico-native-buy-"));
try{
  const source=fs.readFileSync("src/domain/purchases/native-suggestion.ts","utf8");
  const compiled=ts.transpileModule(source,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  fs.writeFileSync(path.join(tmp,"native-suggestion.cjs"),compiled);
  const {nativePurchaseSuggestion:calc}=createRequire(path.join(tmp,"runner.cjs"))("./native-suggestion.cjs");
  assert.equal(calc({stock:8000,minimum:null,averageDaily:0,sampleDays:0,
    packageQuantity:null,unitCost:null}),null,"Sin mínimo ni muestra, jamás inventar reposición");
  assert.equal(calc({stock:14000,minimum:3000,averageDaily:100,sampleDays:7,
    packageQuantity:12000,unitCost:0.024}),null,"Stock suficiente no genera compra");
  const milk=calc({stock:2200,minimum:3000,averageDaily:450,sampleDays:7,
    packageQuantity:12000,unitCost:0.024});
  assert.equal(milk?.packages,1);
  assert.equal(milk?.quantity,12000);
  assert.equal(milk?.estimatedCost,288);
  const unknown=calc({stock:0,minimum:20,averageDaily:0,sampleDays:0,
    packageQuantity:null,unitCost:null});
  assert.equal(unknown?.quantity,20);
  assert.equal(unknown?.estimatedCost,null,"No inventar costo");
  assert.equal(calc({stock:5000,minimum:null,averageDaily:500,sampleDays:2,
    packageQuantity:null,unitCost:0.02}),null,"Dos días no permiten extrapolar demanda");
  assert.equal(calc({stock:200,minimum:null,averageDaily:500,sampleDays:5,
    packageQuantity:1000,unitCost:0.02})?.packages,5);
  const read=fs.readFileSync("src/application/purchases/native.ts","utf8");
  const actions=fs.readFileSync("app/(admin)/admin/purchases/native-actions.ts","utf8");
  const page=fs.readFileSync("app/(admin)/admin/purchases/page.tsx","utf8");
  const schema=fs.readFileSync("src/infrastructure/db/schema.ts","utf8");
  const mig=fs.readFileSync("db/migrations/0030_native_purchase_plan_lines.sql","utf8");
  assert.match(read,/getOpsInventoryIntelligence/);
  assert.doesNotMatch(read,/getInventoryIntelligence.*loyverse|\/loyverse\//i);
  assert.match(actions,/assertNoPreviewMutation\(\)/);
  assert.match(actions,/inventoryItemId:row\.id/);
  assert.match(actions,/variantExternalId:null/);
  assert.match(actions,/await db\.transaction/);
  assert.match(actions,/itemCostHistory/);
  assert.match(page,/saveNativePurchaseItem/);
  assert.match(page,/createNativePurchasePlan/);
  assert.doesNotMatch(page,/getInventoryIntelligence.*loyverse/i);
  assert.match(schema,/inventoryItemId: uuid\("inventory_item_id"\)/);
  assert.match(mig,/ADD COLUMN IF NOT EXISTS inventory_item_id/);
  assert.doesNotMatch(mig,/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
  console.log("Native Purchasing: PASS (no invented demand or cost, package conversion, historic plan compatibility)");
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
