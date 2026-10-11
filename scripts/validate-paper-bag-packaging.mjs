import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {createRequire} from "node:module";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"epico-packaging-"));
try{
 const source=fs.readFileSync("src/domain/pos/paper-bag-packaging.ts","utf8");
 const compiled=ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
 }}).outputText;
 fs.writeFileSync(path.join(temp,"bag.cjs"),compiled);
 const {calculatePaperBagPlan,incrementalPaperBags,isPaperBagInventoryItem,isFourCupCarrierInventoryItem,validateFreeCupCarriers}=createRequire(path.join(temp,"test.cjs"))("./bag.cjs");
 const hojaldra=(n,mode="TAKEAWAY")=>({name:"HOJALDRA",category:"ALIMENTOS",serviceMode:mode,quantity:n});
 const croissant=(n)=>({name:"CROISSANT JAMÓN CON QUESO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:n});
 for(const [n,bags] of [[0,0],[1,1],[2,1],[3,1],[4,2],[5,2],[6,2],[7,3]]){
  assert.equal(calculatePaperBagPlan([hojaldra(n)]).bags,bags);
 }
 assert.equal(calculatePaperBagPlan([hojaldra(5),croissant(2)]).bags,4);
 assert.equal(calculatePaperBagPlan([{name:"Pan SOLO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:5}]).bags,2);
 assert.equal(calculatePaperBagPlan([{name:"Pan SOLO",category:"ALIMENTOS",serviceMode:"DINE_IN",quantity:5}]).bags,0);
 assert.equal(incrementalPaperBags([{name:"PAN SOLO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:2}],
   [{name:"PAN SOLO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:3}]),1);
 assert.equal(validateFreeCupCarriers(2,true),2);
 assert.equal(validateFreeCupCarriers(0,false),0);
 assert.throws(()=>validateFreeCupCarriers(1,false));
 assert.throws(()=>validateFreeCupCarriers(2.5,true));
 assert.equal(isFourCupCarrierInventoryItem({name:"PORTAVASOS 4",unit:"pz",trackingType:"QUANTITY"}),true);
 assert.equal(isFourCupCarrierInventoryItem({name:"CHAROLA DE 4 VASOS",unit:"pz",trackingType:"QUANTITY"}),true);
 assert.equal(isFourCupCarrierInventoryItem({name:"CHAROLA 2 VASOS",unit:"pz",trackingType:"QUANTITY"}),false);
 const labelCode=fs.readFileSync("src/application/pos/extras.ts","utf8");
 assert.ok(labelCode.includes("PORTAVASOS 4 ×"),"La comanda debe indicar la cortesía entregada");
 const check=fs.readFileSync("src/application/pos/live.ts","utf8");
 assert.ok(check.includes("POS_COURTESY_CARRIER_CONSUMED"));
 assert.ok(check.includes("courtesyCupCarriers4=validateFreeCupCarriers"));
 assert.ok(check.includes("savedLinesHaveTakeawayDrink"));
 const server=fs.readFileSync("app/(employee)/pos/live-actions.ts","utf8");
 assert.ok(server.includes("courtesyCupCarriers4:parsed.courtesyCupCarriers4"));
 const save=fs.readFileSync("app/(employee)/pos/actions.ts","utf8");
 assert.ok(save.includes("courtesyCupCarriers4=carrierCount"));
 const ui=fs.readFileSync("app/(employee)/pos/pos-client.tsx","utf8");
 assert.ok(ui.includes("Portavasos de 4 · cortesía"));
 assert.equal(calculatePaperBagPlan([hojaldra(5,"DINE_IN"),croissant(1)]).bags,1);
 assert.equal(calculatePaperBagPlan([{name:"CROISSANT NUTELLA",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:2}]).bags,0);
 assert.equal(incrementalPaperBags([hojaldra(2)],[hojaldra(1)]),0);
 assert.equal(incrementalPaperBags([hojaldra(3)],[hojaldra(2)]),1);
 assert.equal(incrementalPaperBags([],[croissant(3)]),3);
 for(const name of ["BOLSA PAPEL","BOLSA DE PAPEL","Bolsa de papel","bolsa papel"]){
  assert.equal(isPaperBagInventoryItem({name,unit:"pz",trackingType:"QUANTITY"}),true);
 }
 for(const name of ["BOLSA ALIMENTOS QA","MANGA DE PAPEL","BOLSA PLÁSTICO"]){
  assert.equal(isPaperBagInventoryItem({name,unit:"pz",trackingType:"QUANTITY"}),false);
 }
 assert.equal(isPaperBagInventoryItem({name:"BOLSA PAPEL",unit:"g",trackingType:"QUANTITY"}),false);
 assert.equal(isPaperBagInventoryItem({name:"BOLSA PAPEL",unit:"pz",trackingType:"COST_ONLY"}),false);
 const catalog=fs.readFileSync("app/(admin)/admin/pos/packaging/page.tsx","utf8");
 assert.ok(catalog.includes("BOLSA PAPEL"));
 console.log("OPS PACKAGING: 1-7 hojaldras, croissant, dine-in and split incremental PASS");
}finally{fs.rmSync(temp,{recursive:true,force:true});}
