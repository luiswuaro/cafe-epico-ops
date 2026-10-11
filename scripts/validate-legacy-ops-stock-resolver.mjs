import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";
const src="src/domain/pos/resolve-unlinked-ops-ingredient.ts";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ops-legacy-resolver-"));
try{
 fs.writeFileSync(path.join(dir,"resolver.cjs"),ts.transpileModule(fs.readFileSync(src,"utf8"),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
 }).outputText);
 const {resolveUnlinkedOpsIngredient:resolve}=createRequire(path.join(dir,"test.cjs"))("./resolver.cjs");
 const items=[
   {id:"coffee",name:"Café espresso en grano",unit:"g",trackingType:"QUANTITY"},
   {id:"mineral",name:"AGUA MINERAL",unit:"g",trackingType:"QUANTITY"},
   {id:"jarabe",name:"JARABE ICEE",unit:"g",trackingType:"QUANTITY"},
   {id:"iced",name:"HIELO",unit:"g",trackingType:"COST_ONLY"},
 ];
 const locs=[{id:"bar",name:"Barra"},{id:"warehouse",name:"Almacén seco"}];
 const balances=[
   {inventoryItemId:"coffee",locationId:"bar"},
   {inventoryItemId:"coffee",locationId:"warehouse"},
   {inventoryItemId:"mineral",locationId:"bar"},
   {inventoryItemId:"jarabe",locationId:"bar"},
 ];
 const shot=resolve({name:"Café espresso en grano",unitLabel:"peso/volumen",quantity:0.02},items,locs,balances);
 assert.deepEqual(shot,{inventoryItemId:"coffee",locationId:"bar",itemName:"Café espresso en grano",unit:"g",factor:1000,resolution:"OPS_NAME_EXACT"});
 assert.equal(shot.factor*0.02*2,40,"2 cappuccinos each consume 20 g");
 const mineral=resolve({name:"AGUA MINERAL",unitLabel:"peso/volumen",quantity:0.1},items,locs,balances);
 assert.equal(mineral.inventoryItemId,"mineral");assert.equal(mineral.factor*0.1,100);
 assert.equal(resolve({name:"HIELO",unitLabel:"peso/volumen",quantity:0.4},items,locs,balances),null,"ice is COST_ONLY");
 assert.equal(resolve({name:"AGUA",unitLabel:"peso/volumen",quantity:0.08},items,locs,balances),null,"water is COST_ONLY");
 assert.equal(resolve({name:"AGUA MINERAL",unitLabel:"pz",quantity:1},items,locs,balances),null,"unit mismatch cannot debit");
 assert.equal(resolve({name:"ESPRESSO",unitLabel:"peso/volumen",quantity:0.02},items,locs,balances),null,"never guess synonyms");
 const dup=[...items,{id:"another",name:"café espresso en grano",unit:"g",trackingType:"QUANTITY"}];
 const balDup=[...balances,{inventoryItemId:"another",locationId:"bar"}];
 assert.equal(resolve({name:"Café espresso en grano",unitLabel:"g",quantity:20},dup,locs,balDup),null,"ambiguity fails closed");
 const checkout=fs.readFileSync("src/application/pos/live.ts","utf8");
 const readiness=fs.readFileSync("src/application/pos/readiness.ts","utf8");
 assert.match(checkout,/resolveUnlinkedOpsIngredient\(component,nativeItems,locations,fallbackBalances\)/);
 assert.match(checkout,/nativeAutoResolved/);
 assert.match(checkout,/for\("update"\)/);
 assert.match(readiness,/resolveUnlinkedOpsIngredient\(component,nativeItems,locations,balances\)/);
 assert.doesNotMatch(checkout,/if\\(stockShortages.length&&!input.allowStockShortage\\)/);
 assert.match(checkout,/POS_LIVE_INVENTORY_SHORTAGE_AUTO_RECORDED/);
 assert.match(checkout,/theoreticalQuantity:"0"/);
 assert.match(checkout,/onConflictDoNothing\\(\\)/);
 console.log("OPS checkout legacy resolver: PASS (CAPUCCINO 2 shots, ICEE mineral, no guesses, no duplicate, units, COST_ONLY)");
}finally{fs.rmSync(dir,{recursive:true,force:true});}
