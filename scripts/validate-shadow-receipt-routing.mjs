import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const actions=read("app/(employee)/pos/actions.ts");
const receipt=read("app/(employee)/pos/receipt/[id]/page.tsx");
const printer=read("app/(employee)/pos/receipt/[id]/direct-print-button.tsx");
const sections={
  direct:actions.split("export async function submitShadowSale(")[1]?.split("export async function submitShadowCommand(")[0],
  legacy:actions.split("export async function createShadowSale(")[1]?.split("export async function createShadowCommand(")[0],
  saved:actions.split("export async function payShadowCommand(")[1]?.split("export async function createPosCustomer(")[0],
};
for(const [name,body] of Object.entries(sections)){
  assert.ok(body,"Missing "+name);
  assert.match(body,/redirect\("\/pos\/receipt\//,
    name+" must send paid SHADOW order directly to receipt");
  assert.doesNotMatch(body,/redirect\("\/pos\?saved=/,
    name+" cannot send cashier back to Loyverse comparison after payment");
  if(name==="saved"){
    assert.doesNotMatch(body,/autoKitchen=paid/,
      "Paying a previously SAVED order must not reprint its kitchen slip");
  }else{
    assert.match(body,/autoKitchen=paid-direct/,
      "Direct SHADOW checkout prints kitchen slip once, even in production");
  }
}
assert.match(receipt,/simulation: order\.order\.mode==="SHADOW"/);
assert.match(receipt,/PRUEBA · PAGO SIMULADO/);
assert.match(receipt,/query\.autoKitchen==="paid-direct"&&/);
assert.match(receipt,/order\.order\.mode==="LIVE"\|\|order\.order\.mode==="SHADOW"/);
assert.match(printer,/ticket\.simulation \? "COMPROBANTE DE PRUEBA"/);
console.log("POS SHADOW receipt routing: PASS (3 routes, receipt label, no duplicate saved slip, direct prints kitchen slip)");
