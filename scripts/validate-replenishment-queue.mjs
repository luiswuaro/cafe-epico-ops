import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {createRequire} from "node:module";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"epico-reabasto-"));
try{
 const original=fs.readFileSync("src/domain/inventory/replenishment-queue.ts","utf8");
 fs.writeFileSync(path.join(temp,"queue.cjs"),ts.transpileModule(original,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
 }).outputText);
 const {buildReplenishmentQueue}=createRequire(path.join(temp,"test.cjs"))("./queue.cjs");
 const items=[
  {id:"milk",name:"LECHE",unit:"ml",balance:350,minimum:null},
  {id:"coffee",name:"CAFÉ",unit:"g",balance:-20,minimum:null},
  {id:"condensed",name:"LECHE CONDENSADA",unit:"g",balance:1600,minimum:null},
  {id:"tapioca",name:"POPOTE",unit:"pz",balance:null,minimum:null},
  {id:"cup",name:"VASOS",unit:"pz",balance:8,minimum:20},
  {id:"green",name:"CAFÉ VERDE",unit:"g",balance:0,minimum:null},
  {id:"water",name:"AGUA",unit:"g",balance:0,minimum:null},
 ];
 const use=[
  {inventoryItemId:"milk",product:"LATTE",quantity:150,unit:"ml"},
  {inventoryItemId:"milk",product:"LATTE ESPAÑOL FRÍO",quantity:300,unit:"ml"},
  {inventoryItemId:"coffee",product:"LATTE",quantity:20,unit:"g"},
  {inventoryItemId:"condensed",product:"LATTE ESPAÑOL FRÍO",quantity:40,unit:"g"},
  {inventoryItemId:"tapioca",product:"FRÍOS",quantity:1,unit:"pz"},
  {inventoryItemId:"cup",product:"LATTE FRÍO",quantity:1,unit:"pz"},
  {inventoryItemId:"water",product:"AGUA MINERAL",quantity:0,unit:"g"},
 ];
 const q=buildReplenishmentQueue(items,use);
 assert.equal(q.all.length,5,"No incluir café verde ni agua sin uso POS");
 assert.equal(q.alerts[0].id,"coffee");
 assert.equal(q.alerts[0].severity,"AGOTADO");
 assert.equal(q.all.find(x=>x.id==="milk").theoreticalPortions,1);
 assert.equal(q.all.find(x=>x.id==="milk").maxPortion,300);
 assert.equal(q.all.find(x=>x.id==="milk").severity,"POCAS_PORCIONES");
 assert.equal(q.all.find(x=>x.id==="condensed").theoreticalPortions,40);
 assert.equal(q.all.find(x=>x.id==="condensed").severity,"OK");
 assert.equal(q.all.find(x=>x.id==="cup").deficitToMinimum,12);
 assert.equal(q.all.find(x=>x.id==="cup").severity,"BAJO_MINIMO");
 assert.equal(q.all.find(x=>x.id==="tapioca").severity,"SIN_CONTEO");
 assert.equal(q.all.find(x=>x.id==="tapioca").theoreticalPortions,null);
 const page=fs.readFileSync("app/(employee)/pos/reabasto/page.tsx","utf8");
 const pos=fs.readFileSync("app/(employee)/pos/page.tsx","utf8");
 const commands=fs.readFileSync("app/(employee)/pos/orders/page.tsx","utf8");
 assert.ok(page.includes("getOpsReplenishmentQueue"));
 assert.ok(pos.includes('href="/pos/reabasto"'));
 assert.ok(commands.includes("Ver receta ↗"));
 assert.ok(commands.includes("knownRecipes.has(line.catalogId)"));
 const ordersService=fs.readFileSync("src/application/pos/orders.ts","utf8");
 assert.ok(ordersService.includes("catalogId: posOrderLines.catalogExternalId"),
  "Las recetas de comandas deben apuntar al ID exacto y no al nombre");
 assert.ok(!page.includes("LOYVERSE_OVERRIDE"));
 console.log("OPS reabasto: saldos, sin conteo, cobertura, mínimos y accesos PASS");
}finally{fs.rmSync(temp,{recursive:true,force:true});}
