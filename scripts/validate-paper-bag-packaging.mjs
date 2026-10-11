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
 const {calculatePaperBagPlan,incrementalPaperBags}=createRequire(path.join(temp,"test.cjs"))("./bag.cjs");
 const hojaldra=(n,mode="TAKEAWAY")=>({name:"HOJALDRA",category:"ALIMENTOS",serviceMode:mode,quantity:n});
 const croissant=(n)=>({name:"CROISSANT JAMÓN CON QUESO",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:n});
 for(const [n,bags] of [[0,0],[1,1],[2,1],[3,1],[4,2],[5,2],[6,2],[7,3]]){
  assert.equal(calculatePaperBagPlan([hojaldra(n)]).bags,bags);
 }
 assert.equal(calculatePaperBagPlan([hojaldra(5),croissant(2)]).bags,4);
 assert.equal(calculatePaperBagPlan([hojaldra(5,"DINE_IN"),croissant(1)]).bags,1);
 assert.equal(calculatePaperBagPlan([{name:"CROISSANT NUTELLA",category:"ALIMENTOS",serviceMode:"TAKEAWAY",quantity:2}]).bags,0);
 assert.equal(incrementalPaperBags([hojaldra(2)],[hojaldra(1)]),0);
 assert.equal(incrementalPaperBags([hojaldra(3)],[hojaldra(2)]),1);
 assert.equal(incrementalPaperBags([],[croissant(3)]),3);
 const catalog=fs.readFileSync("app/(admin)/admin/pos/packaging/page.tsx","utf8");
 assert.ok(catalog.includes("BOLSA DE PAPEL"));
 console.log("OPS PACKAGING: 1-7 hojaldras, croissant, dine-in and split incremental PASS");
}finally{fs.rmSync(temp,{recursive:true,force:true});}
