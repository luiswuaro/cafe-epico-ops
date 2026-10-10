import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-beneficios-"));
try {
  const source=fs.readFileSync(path.join(process.cwd(),"src/domain/pos/benefits-preview.ts"),"utf8");
  fs.writeFileSync(path.join(dir,"calc.cjs"),ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {calculateBenefitPreview:calc}=createRequire(path.join(dir,"run.cjs"))("./calc.cjs");
  const latte={id:"a",name:"Latte",category:"CALIENTES",basePrice:60,extras:0,ownThermos:false};
  const taro={id:"b",name:"Taro frío",category:"FRÍAS",basePrice:70,extras:0,ownThermos:false};
  const input=(kind,other={})=>({
    kind,scope:"LINE",lineId:"a",value:0,reason:"Atención de servicio",
    availablePoints:20,mxnPerPoint:1,staffFreeAlreadyUsed:false,...other,
  });
  let r=calc([latte],input("STAFF_10"));
  assert.equal(r.valid,true);
  assert.equal(r.ordinaryDiscount,6);
  assert.equal(r.due,54);
  assert.equal(r.earnablePoints,2.7);
  r=calc([{...latte,extras:10}],input("STAFF_FREE"));
  assert.equal(r.valid,true);
  assert.equal(r.due,10);
  r=calc([latte],input("STAFF_FREE",{staffFreeAlreadyUsed:true}));
  assert.equal(r.valid,false);
  assert.equal(r.ordinaryDiscount,0);
  r=calc([latte],input("POINTS",{scope:"TICKET",value:10}));
  assert.equal(r.valid,true);
  assert.equal(r.redeemedPoints,10);
  assert.equal(r.due,50);
  r=calc([latte],input("POINTS",{value:20,mxnPerPoint:0}));
  assert.equal(r.valid,false);
  r=calc([latte],input("POINTS",{value:21}));
  assert.equal(r.valid,false);
  assert.equal(r.redeemedPoints,0);
  r=calc([latte,taro],input("MANUAL_FIXED",{scope:"TICKET",value:5}));
  assert.equal(r.valid,true);
  assert.equal(r.ordinaryDiscount,5);
  assert.equal(r.due,125);
  assert.equal(r.perLine.reduce((n,x)=>n+x.benefitDiscount,0),5);
  r=calc([latte],input("MANUAL_PERCENT",{value:15}));
  assert.equal(r.ordinaryDiscount,9);
  assert.equal(r.due,51);
  r=calc([latte],input("MANUAL_PERCENT",{value:101}));
  assert.equal(r.valid,false);
  r=calc([{...latte,ownThermos:true},{...taro,ownThermos:true}],input("NONE"));
  assert.equal(r.valid,true);
  assert.equal(r.thermosSavings,10);
  assert.equal(r.due,120);
  r=calc([{...latte,ownThermos:true}],input("STAFF_10"));
  assert.equal(r.valid,false);
  r=calc([latte],input("MANUAL_FIXED",{reason:"",value:5}));
  assert.equal(r.valid,false);
  console.log("POS beneficios preview: PASS (termo, personal, puntos, límites y descuentos)");
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
