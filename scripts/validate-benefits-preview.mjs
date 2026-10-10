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
  const {calculateBenefitPreview:calc,calculateEarnedPointsFromRealMoney:earn,
    calculateEarnedPointsFromMonetaryPayments:earnPayments}=createRequire(path.join(dir,"run.cjs"))("./calc.cjs");
  // Las compras se premian solo por dinero efectivamente cobrado.
  assert.equal(earn(100),5);
  assert.equal(earn(0),0);
  assert.equal(earn(54.65),2.73);
  assert.equal(earnPayments([{method:"CASH",amount:100}]).earnedPoints,5);
  assert.equal(earnPayments([{method:"CARD",amount:100}]).earnedPoints,5);
  assert.equal(earnPayments([{method:"TRANSFER",amount:100}]).earnedPoints,5);
  assert.deepEqual(earnPayments([
    {method:"CASH",amount:25},{method:"CARD",amount:45},
    {method:"TRANSFER",amount:30},
  ]),{monetaryPaid:100,earnedPoints:5});
  assert.throws(()=>earnPayments([{method:"POINTS",amount:50}]));
  assert.throws(()=>earnPayments([{method:"CASH",amount:-1}]));

  const latte={id:"a",name:"Latte",category:"CALIENTES",basePrice:60,extras:0,ownThermos:false};
  const taro={id:"b",name:"Taro frío",category:"FRÍAS",basePrice:70,extras:0,ownThermos:false};
  const input=(kind,other={})=>({
    kind,scope:"LINE",lineId:"a",value:0,reason:"Atención de servicio",
    availablePoints:20,customerSelected:true,staffFreeAlreadyUsed:false,...other,
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
  assert.equal(r.earnablePoints,2.5); // $60 - $10 pts = $50 real
  r=calc([latte],input("POINTS",{value:20,customerSelected:false}));
  assert.equal(r.valid,false);
  assert.equal(r.redeemedPoints,0);
  r=calc([latte],input("POINTS",{value:0}));
  assert.equal(r.valid,false);
  r=calc([latte],input("POINTS",{value:20}));
  assert.equal(r.valid,true);
  assert.equal(r.due,40);
  assert.equal(r.perLine[0].redeemedValue,20);
  r=calc([latte],input("POINTS",{value:21}));
  assert.equal(r.valid,false);
  assert.equal(r.redeemedPoints,0);
  r=calc([latte,taro],input("POINTS",{scope:"LINE",lineId:"b",value:20}));
  assert.equal(r.valid,true);
  assert.equal(r.due,110);
  assert.equal(r.perLine[0].redeemedValue,0);
  assert.equal(r.perLine[1].redeemedValue,20);
  r=calc([latte,taro],input("POINTS",{scope:"TICKET",value:20}));
  assert.equal(r.valid,true);
  assert.equal(r.perLine.reduce((n,x)=>n+x.redeemedValue,0),20);
  r=calc([latte],input("POINTS",{scope:"TICKET",value:60,availablePoints:60}));
  assert.equal(r.valid,true);
  assert.equal(r.due,0);
  assert.equal(r.earnablePoints,0);
  // Cuenta de $150; 50 puntos (50 MXN) + 100 MXN cobrados = 5 pts nuevos.
  const latte90={...latte,basePrice:90};
  r=calc([latte90,taro],input("POINTS",{scope:"TICKET",value:50,availablePoints:50}));
  assert.equal(r.valid,true);
  assert.equal(r.due,110);
  assert.equal(r.earnablePoints,5.5);
  r=calc([{...latte,basePrice:80},taro],input("POINTS",{scope:"TICKET",value:50,availablePoints:50}));
  assert.equal(r.due,100);
  assert.equal(r.earnablePoints,5);

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
  console.log("POS beneficios preview: PASS (termo, personal, 1pt=1MXN, 5% sobre dinero real, pagos mixtos, límites y descuentos)");
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
