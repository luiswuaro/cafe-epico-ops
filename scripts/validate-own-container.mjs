import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epic-own-thermos-"));
try{
  const source=fs.readFileSync(path.join(process.cwd(),"src/domain/pos/own-container.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  fs.writeFileSync(path.join(dir,"own-container.cjs"),compiled);
  const rule=createRequire(path.join(dir,"runner.cjs"))("./own-container.cjs");
  const hot={category:"CALIENTES"},cold={category:"FRÍAS"},food={category:"ALIMENTOS"};
  assert.equal(rule.canUseOwnContainer(hot,"TAKEAWAY"),true);
  assert.equal(rule.canUseOwnContainer(cold,"TAKEAWAY"),true);
  assert.equal(rule.canUseOwnContainer(food,"TAKEAWAY"),false);
  assert.equal(rule.canUseOwnContainer(hot,"DINE_IN"),false);
  assert.equal(rule.ownContainerUnitPrice(60,0,true),55);
  assert.equal(rule.ownContainerUnitPrice(60,10,true),65);
  assert.equal(rule.ownContainerUnitPrice(60,10,false),70);
  const recipe=[
    {name:"CAFÉ EN GRANO",quantity:18},
    {name:"LECHE",quantity:230},
    {name:"VASO CARTÓN 12 OZ",quantity:1},
    {name:"TAPA PLÁSTICA",quantity:1},
    {name:"FAJILLA NEGRA",quantity:1},
    {name:"SERVILLETA",quantity:1},
    {name:"POPOTE",quantity:1},
    {name:"JARABE",quantity:15},
  ];
  assert.deepEqual(rule.preparedOwnContainerComponents(recipe,false),recipe);
  assert.deepEqual(rule.preparedOwnContainerComponents(recipe,true).map(x=>x.name),
    ["CAFÉ EN GRANO","LECHE","JARABE"]);
  assert.equal(rule.isOwnContainerSnapshot({customerContainer:true}),true);
  assert.equal(rule.isOwnContainerSnapshot({customerContainer:false}),false);
  assert.equal(rule.isOwnContainerSnapshot(null),false);
  assert.deepEqual(rule.ownContainerReadinessErrors([
    "Sin existencias: VASO CARTÓN 12 OZ",
    "Falta tapa para llevar",
    "Sin equivalencia: LECHE",
    "Sin existencias: CAFÉ EN GRANO",
  ],true),["Sin equivalencia: LECHE","Sin existencias: CAFÉ EN GRANO"]);
  console.log("Termo propio: PASS (precios, elegibilidad, empaques, snapshot y stock)");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
