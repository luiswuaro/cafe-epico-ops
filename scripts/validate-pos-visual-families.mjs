import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import ts from "typescript";

const folder=fs.mkdtempSync(path.join(os.tmpdir(),"epico-pos-visual-"));
try{
  const source=fs.readFileSync("src/domain/pos/catalog-visuals.ts","utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText;
  fs.writeFileSync(path.join(folder,"catalog-visuals.cjs"),compiled);
  const visuals=createRequire(path.join(folder,"runner.cjs"))("./catalog-visuals.cjs");
  const hot=[
    ["ESPRESSO","espresso"],["AMERICANO","espresso"],["ESPRESSO CORTADO","espresso"],
    ["CAPUCCINO","milk"],["LATTE","milk"],["LATTE ESPAÑOL","milk"],["FLAT WHITE","milk"],["MOKA","milk"],
    ["CHOCOLATE CALIENTE","chocolate"],["CHAI MASALA","tea"],["DIRTY CHAI CALIENTE","tea"],
    ["MATCHA LATTE","botanical"],["TARO LATTE","botanical"],
    ["DIRTY HORCHATA","signature"],["PUMPKIN SPICE LATTE CALIENTE","signature"],
  ];
  for(const [name,expected] of hot){
    assert.equal(visuals.posVisualFamily({name,category:"CALIENTES"}),expected,name);
  }
  const cold=[
    ["AMERICANO FRIO","coffee"],["ESPRESSO TÓNICO NARANJA","tonic"],
    ["FRAPPE CAPUCCINO","frappe"],["MATCHA LATTE FRÍO","tea"],
    ["CHOCOLATE FRIO","chocolate"],["SODA ITALIANA MANZANA VERDE","refresh"],
    ["ICEE","refresh"],["PUMPKIN SPICE LATTE FRÍO","signature"],
  ];
  for(const [name,expected] of cold){
    assert.equal(visuals.posVisualFamily({name,category:"FRÍAS"}),expected,name);
  }
  const food=[
    ["CROISSANT","bread"],["FLAN","dessert"],["CROISSANT JAMÓN","savory"],
    ["Pan CON BEBIDA","combo"],
  ];
  for(const [name,expected] of food){
    assert.equal(visuals.posVisualFamily({name,category:"ALIMENTOS"}),expected,name);
  }
  const menu=[
    {id:"a",name:"DIRTY HORCHATA",price:60,category:"CALIENTES"},
    {id:"b",name:"LATTE",price:50,category:"CALIENTES"},
    {id:"c",name:"AMERICANO",price:30,category:"CALIENTES"},
    {id:"d",name:"FLAN",price:35,category:"ALIMENTOS"},
    {id:"e",name:"SODA KIWI",price:60,category:"FRÍAS"},
    {id:"f",name:"ESPRESSO",price:30,category:"CALIENTES"},
  ];
  const sorted=[...menu].sort(visuals.comparePosVisualProducts);
  assert.deepEqual(sorted.map(item=>item.name),
    ["AMERICANO","ESPRESSO","LATTE","DIRTY HORCHATA","SODA KIWI","FLAN"]);
  assert.deepEqual(menu.map(item=>[item.id,item.price]),[
    ["a",60],["b",50],["c",30],["d",35],["e",60],["f",30],
  ],"Sólo ordenamos una copia del menú y no modificamos el precio");
  const sourceUi=fs.readFileSync("app/(employee)/pos/pos-client.tsx","utf8");
  const css=fs.readFileSync("app/globals.css","utf8");
  assert.match(sourceUi,/visualCatalog=useMemo/);
  assert.match(sourceUi,/visualFamilies\.map\(family/);
  assert.match(sourceUi,/data-family=\{family\}/);
  assert.match(sourceUi,/data-category=\{item\.category\}/);
  assert.match(css,/pos-product-family/);
  assert.match(css,/data-theme="dark"/);
  assert.match(css,/pos-category-tabs button\.active\[data-category\]/);
  console.log("POS visual: PASS (15 calientes, frías, alimentos, orden fijo, filtros, precio intacto, temas)");
}finally{
  fs.rmSync(folder,{recursive:true,force:true});
}
