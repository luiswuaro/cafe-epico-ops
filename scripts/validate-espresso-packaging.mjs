import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import ts from "typescript";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"epico-espresso-4oz-"));
try{
  const source=fs.readFileSync("src/domain/pos/takeaway-packaging.ts","utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  fs.writeFileSync(path.join(directory,"takeaway-packaging.cjs"),compiled);
  const rules=createRequire(path.join(directory,"runner.cjs"))("./takeaway-packaging.cjs");
  const espresso={name:"ESPRESSO",category:"CALIENTES"};
  const americano={name:"AMERICANO",category:"CALIENTES"};
  const tonic={name:"ESPRESSO TÓNICO",category:"FRÍAS"};
  const cup4=[{name:"Café espresso en grano"},{name:"Vaso 4 oz"}];
  const cup12=[{name:"Café espresso en grano"},{name:"VASO CALIENTE 12OZ"}];
  const cup16=[{name:"VASO FRIO 16OZ"}];
  assert.equal(rules.isEspressoTakeawayWithoutLid(espresso),true);
  assert.equal(rules.isEspressoTakeawayWithoutLid(tonic),false);
  assert.deepEqual(rules.takeawayPackagingErrors(espresso,cup4),[]);
  assert.deepEqual(rules.takeawayPackagingErrors(espresso,[{name:"VASO CALIENTE 4OZ"}]),[]);
  assert.match(rules.takeawayPackagingErrors(espresso,cup12).join(" "),/4 oz/);
  assert.match(rules.takeawayPackagingErrors(espresso,[...cup4,{name:"TAPA 8OZ"}]).join(" "),/no utiliza tapa/);
  assert.match(rules.takeawayPackagingErrors(espresso,[]).join(" "),/Falta vaso/);
  assert.deepEqual(rules.takeawayPackagingErrors(americano,[...cup12,{name:"TAPA CALIENTE 12OZ"}]),[]);
  assert.match(rules.takeawayPackagingErrors(americano,cup12).join(" "),/Falta tapa/);
  assert.match(rules.takeawayPackagingErrors(tonic,cup16).join(" "),/Falta tapa/);
  assert.deepEqual(rules.takeawayPackagingErrors({name:"CROISSANT",category:"ALIMENTOS"},[]),[]);

  for (const file of ["src/application/pos/live.ts",
    "src/application/pos/readiness.ts","src/application/pos/extra-packaging.ts"]){
    assert.match(fs.readFileSync(file,"utf8"),/takeawayPackagingErrors/);
  }
  console.log("Espresso para llevar: PASS (vaso 4oz, sin tapa, otras bebidas, cobro y comanda)");
}finally{
  fs.rmSync(directory,{recursive:true,force:true});
}
