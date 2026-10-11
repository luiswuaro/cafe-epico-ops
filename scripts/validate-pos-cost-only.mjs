import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const base=fs.mkdtempSync(path.join(os.tmpdir(),"epico-cost-only-"));
try{
  const source=fs.readFileSync("src/application/pos/component-policy.ts","utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  const target=path.join(base,"policy.cjs");
  fs.writeFileSync(target,compiled);
  const {isCostOnlyComponent,costOnlyComponentName,costOnlyRecipeMeasure}=createRequire(import.meta.url)(target);
  const legacyWater={name:"AGUA",unitLabel:"peso/volumen",quantity:0.08,
    variantExternalId:"976e2d13-eefa-4a36-b1f5-b29f9ddb2bb0",
    itemExternalId:"eab0af54-b569-4b87-bb65-e12b84bc7797"};
  const noIdIce={name:"HIELO",unitLabel:"peso/volumen",quantity:0.15,
    variantExternalId:null,itemExternalId:null,category:null};
  const nativeWater={name:"AGUA",unitLabel:"g",quantity:80,costOnlyCode:"WATER",
    variantExternalId:null,itemExternalId:null,inventoryItemId:null,inventoryLocationId:null};
  const nativeIce={name:"HIELO",unitLabel:"g",quantity:150,costOnlyCode:"ICE",
    variantExternalId:null,itemExternalId:null};
  const mineral={name:"AGUA MINERAL",unitLabel:"g",quantity:200,
    variantExternalId:"b6ca2619-7b79-451f-ae10-8f96bc3239d6",
    itemExternalId:"2f00574d-b9c9-47cc-ac1a-54b2a1ecd70a"};
  const tonic={name:"AGUA TÓNICA",unitLabel:"pz",quantity:1,
    variantExternalId:"474596b8-b9bf-413f-80f1-d5550a2b79bf",
    itemExternalId:"f1346b9e-bef0-4dd6-9a8b-6f17a8c6e656"};
  for(const component of [legacyWater,noIdIce,nativeWater,nativeIce]){
    assert.equal(isCostOnlyComponent(component),true,component.name);
  }
  for(const component of [mineral,tonic]){
    assert.equal(isCostOnlyComponent(component),false,component.name);
  }
  assert.equal(costOnlyComponentName(nativeWater),"Agua");
  assert.equal(costOnlyRecipeMeasure(legacyWater,0.08).quantity,80);
  assert.equal(costOnlyRecipeMeasure(nativeWater,80).quantity,80);
  assert.equal(costOnlyRecipeMeasure(noIdIce,0.15).quantity,150);
  assert.equal(costOnlyRecipeMeasure(nativeIce,150).quantity,150);
  assert.equal(costOnlyRecipeMeasure(nativeIce,150).estimatedCostMxn,null);
  assert.equal(isCostOnlyComponent({...nativeWater,inventoryItemId:"item"}),false);
  assert.equal(isCostOnlyComponent({...mineral,costOnlyCode:"WATER"}),false);
  assert.equal(isCostOnlyComponent({name:"AGUA MINERAL",variantExternalId:null,itemExternalId:null}),false);
  assert.equal(isCostOnlyComponent({name:"HIELO",variantExternalId:"untracked-id",itemExternalId:null}),false);
  console.log("POS COST_ONLY: PASS (legacy water, unlinked ice, OPS virtual g, non-stock, mineral/tonic protected)");
}finally{fs.rmSync(base,{recursive:true,force:true});}
