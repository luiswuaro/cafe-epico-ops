import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-recipe-"));
try{
  const moduleText=fs.readFileSync("src/domain/recipes/bar-recipe-projection.ts","utf8")
    // Transpile this pure projector without runtime imports from Next.
    .replace('import {isCostOnlyComponent} from "@/src/application/pos/component-policy";',
      'const isCostOnlyComponent=(c:{costOnlyCode?:string|null})=>Boolean(c.costOnlyCode);')
    .replace('import {type OperationalRecipeCategory,operationalRecipeCategoryOrder} from "@/src/domain/recipes/operational";',
      'type OperationalRecipeCategory="CALIENTES"|"FRÍAS"|"ALIMENTOS"; const operationalRecipeCategoryOrder=(s:string)=>["CALIENTES","FRÍAS","ALIMENTOS"].indexOf(s);');
  fs.writeFileSync(path.join(dir,"projector.cjs"),ts.transpileModule(moduleText,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText);
  const {projectBarRecipe}=createRequire(path.join(dir,"test.cjs"))("./projector.cjs");
  const component=(name,quantity,unitLabel="g",extra={})=>({
    name,quantity,unitLabel,category:"OPS",variantExternalId:null,itemExternalId:null,...extra,
  });
  const item={id:"item-1",name:"LATTE ESPAÑOL FRÍO",category:"FRÍAS",sourceType:"LOYVERSE",
    serviceRecipes:{
      DINE_IN:{configured:true,components:[
        component("Café espresso en grano",20),
        component("LECHE CONDENSADA",40),
        component("HIELO",150,"g",{costOnlyCode:"ICE"}),
        component("POPOTE PARA TAPIOCA",1,"pz"),
        component("AGUA",80,"g",{costOnlyCode:"WATER"}),
      ]},
      TAKEAWAY:{configured:true,components:[
        component("Café espresso en grano",20),component("LECHE CONDENSADA",40),
        component("VASO FRIO 16OZ",1,"pz"),component("TAPA PLANA16 OZ",1,"pz"),
      ]},
    },
  };
  const result=projectBarRecipe(item);
  assert.equal(result.serviceRecipes.DINE_IN.ingredients.find(c=>c.name==="LECHE CONDENSADA")?.quantity,40);
  assert.equal(result.serviceRecipes.TAKEAWAY.ingredients.find(c=>c.name==="LECHE CONDENSADA")?.quantity,40);
  assert.equal(result.serviceRecipes.DINE_IN.service.some(c=>c.name.includes("POPOTE")),true);
  assert.equal(result.serviceRecipes.TAKEAWAY.service.some(c=>c.name.includes("VASO")),true);
  assert.equal(result.serviceRecipes.DINE_IN.costOnly.find(c=>c.name==="AGUA")?.quantity,80);
  const page=fs.readFileSync("app/(employee)/recipes/page.tsx","utf8");
  const details=fs.readFileSync("app/(employee)/recipes/[id]/page.tsx","utf8");
  const book=fs.readFileSync("src/application/recipes/pos-bar-book.ts","utf8");
  assert.ok(page.includes("getEmployeePosRecipeBook"));
  assert.ok(details.includes("getEmployeePosRecipe"));
  assert.ok(book.includes("getPosCatalog(organizationId)"));
  assert.ok(!page.includes('getEmployeeRecipeBook'));
  const auditText=fs.readFileSync("src/domain/recipes/consistency-audit.ts","utf8")
    .replace('import {normalizeOperationalRecipeName} from "@/src/domain/recipes/operational";',
      'const normalizeOperationalRecipeName=(v:string)=>v.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toUpperCase().trim();');
  fs.writeFileSync(path.join(dir,"audit.cjs"),ts.transpileModule(auditText,{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText);
  const {compareHistoricalToOps}=createRequire(path.join(dir,"test.cjs"))("./audit.cjs");
  const audited=compareHistoricalToOps([{
    name:"LATTE ESPAÑOL FRÍO",category:"FRÍAS",
    components:[{sourceName:"LECHE CONDENSADA",displayQuantity:45,displayUnit:"g",
      isComposite:false,isDisposable:false}],
  }],[result]);
  assert.equal(audited.differences.length,2,"Diferencia visible por modalidad, sin multiplicar productos");
  assert.equal(audited.differences[0].historical,45);
  assert.equal(audited.differences[0].live,40);
  assert.equal(audited.differences[0].unit,"g");
  console.log("Bar recipe: POS single source, serve modes, historical 45 g vs POS 40 g audited PASS");
}finally{fs.rmSync(dir,{recursive:true,force:true});}
