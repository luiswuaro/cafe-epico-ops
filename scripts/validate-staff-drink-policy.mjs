import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-staff-benefits-"));
try{
  const source=fs.readFileSync(path.join(process.cwd(),"src/domain/pos/staff-drink-policy.ts"),"utf8");
  fs.writeFileSync(path.join(dir,"rules.cjs"),ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {calculateStaffDrinkBenefit:calc}=createRequire(path.join(dir,"runner.cjs"))("./rules.cjs");
  const latte={category:"CALIENTES",basePrice:60,extrasPrice:0,ownThermos:false};
  const frappe={category:"FRÍAS",basePrice:80,extrasPrice:10,ownThermos:false};
  let r=calc([latte],"INCLUDED_DRINK");
  assert.equal(r.discount,60);
  assert.equal(r.warnings.length,0);
  r=calc([frappe],"INCLUDED_DRINK");
  assert.equal(r.discount,80); // El extra de $10 se cobra.
  r=calc([frappe],"ADDITIONAL_10");
  assert.equal(r.discount,8); // Solo 10% sobre bebida base; extra permanece.
  assert.equal(90-r.discount,82);
  r=calc([{...latte,ownThermos:true}],"INCLUDED_DRINK");
  assert.equal(r.discount,0);
  assert.ok(r.warnings.length>0);
  r=calc([latte,frappe],"INCLUDED_DRINK");
  assert.equal(r.discount,0);
  assert.ok(r.warnings.length>0);
  r=calc([{...latte,category:"ALIMENTOS"}],"INCLUDED_DRINK");
  assert.equal(r.discount,0);
  r=calc([],"INCLUDED_DRINK");
  assert.equal(r.discount,0);
  r=calc([latte],"NONE");
  assert.equal(r.discount,0);
  console.log("POS staff benefits: PASS (1 bebida, extras, 10%, sin apilar termo)");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
