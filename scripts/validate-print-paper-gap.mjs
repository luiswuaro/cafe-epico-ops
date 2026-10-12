import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=fs.readFileSync("src/application/pos/print-paper-gap.ts","utf8");
const javascript=ts.transpileModule(source,{compilerOptions:{
 module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
}}).outputText;
const store=new Map();
let clock=100000;
const waits=[];
const printed=[];
const module={exports:{}};
const window={
 localStorage:{
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,String(value)),
 },
 setTimeout:(fn,ms)=>{waits.push(ms);clock+=ms;fn();return 1},
};
const navigator={locks:{request:async(_name,_options,fn)=>fn()}};
vm.runInNewContext(javascript,{module,exports:module.exports,window,navigator,
 URL,Date:{now:()=>clock},Promise,Number,Math,Error});
const {printWithPaperCutGap,getPaperCutGapSeconds,setPaperCutGapSeconds}=module.exports;
assert.equal(getPaperCutGapSeconds(),12);
await printWithPaperCutGap(async()=>{printed.push(["COMANDA",clock]);return true},undefined,"http://localhost:9137");
await printWithPaperCutGap(async()=>{printed.push(["TICKET",clock]);return true},undefined,"http://127.0.0.1:9137");
assert.equal(printed[1][1]-printed[0][1],12000);
assert.equal(waits.at(-1),12000);
setPaperCutGapSeconds(8);
assert.equal(getPaperCutGapSeconds(),8);
await printWithPaperCutGap(async()=>{printed.push(["2DO TICKET",clock]);return true},undefined,"http://127.0.0.1:9137");
assert.equal(printed[2][1]-printed[1][1],8000);
await printWithPaperCutGap(async()=>{printed.push(["SEGUNDA IMPRESORA",clock]);return true},undefined,"http://127.0.0.1:9138");
assert.equal(printed[3][1],printed[2][1],"No frenar impresoras separadas");
const before=store.size;
await assert.rejects(()=>printWithPaperCutGap(async()=>{throw Error("bridge failed")},undefined,"http://127.0.0.1:9140"),/bridge failed/);
assert.equal(store.size,before,"No simular una impresión exitosa en caso de error del puente");
console.log("Pausa entre COMANDA/TICKET y puertos independientes PASS");
