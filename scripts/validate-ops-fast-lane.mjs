import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import ts from "typescript";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epico-fast-lane-"));
try{
  const pure=fs.readFileSync("src/domain/pos/command-timing.ts","utf8");
  fs.writeFileSync(path.join(dir,"timing.cjs"),ts.transpileModule(pure,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  }}).outputText);
  const {deriveCommandTimeline,durationSeconds,durationText}=
    createRequire(path.join(dir,"test.cjs"))("./timing.cjs");
  const t=sec=>new Date(Date.UTC(2026,9,11,12,0,sec));
  const order=t(0),first=[{createdAt:t(0),expectedConsumption:{roundId:"INITIAL"}}];
  const mk=(action,sec,afterData)=>({action,createdAt:t(sec),afterData});
  const print=mk("POS_COMMAND_PRINT_ACKNOWLEDGED",5,{roundId:"INITIAL"});
  const preparing=mk("POS_COMMAND_STATUS_CHANGED",9,{status:"PREPARING"});
  const ready=mk("POS_COMMAND_STATUS_CHANGED",30,{status:"READY"});
  let result=deriveCommandTimeline(order,first,[ready,print,preparing]);
  assert.equal(durationSeconds(result.printAckAt,result.readyAt),25);
  assert.equal(durationSeconds(result.preparingAt,result.readyAt),21);
  assert.equal(result.dispatchedAt,null);
  assert.equal(durationText(125),"2:05");
  result=deriveCommandTimeline(order,first,[ready]);
  assert.equal(result.printAckAt,null,"Sin acuse del puente, no inventar impresión");
  assert.equal(result.readyAt.getTime(),t(30).getTime());

  // Una nueva ronda no debe heredar el reloj de la ronda anterior.
  const second=[...first,{createdAt:t(45),expectedConsumption:{roundId:"RONDA_2"}}];
  result=deriveCommandTimeline(order,second,[print,preparing,ready]);
  assert.equal(result.roundId,"RONDA_2");
  assert.equal(result.printAckAt,null);
  assert.equal(result.readyAt,null);
  const roundPrint=mk("POS_COMMAND_PRINT_ACKNOWLEDGED",46,{roundId:"RONDA_2"});
  const roundReady=mk("POS_COMMAND_STATUS_CHANGED",59,{status:"READY"});
  result=deriveCommandTimeline(order,second,[print,ready,roundPrint,roundReady]);
  assert.equal(durationSeconds(result.printAckAt,result.readyAt),13);
  const delivered=mk("POS_TAKEAWAY_DISPATCHED",61,{roundId:"RONDA_2"});
  result=deriveCommandTimeline(order,second,[print,ready,roundPrint,roundReady,delivered]);
  assert.equal(durationSeconds(result.readyAt,result.dispatchedAt),2);
  assert.equal(result.dispatchedAt?.getTime(),t(61).getTime());
  const actions=fs.readFileSync("app/(employee)/pos/actions.ts","utf8");
  assert.ok(actions.includes('action:"POS_TAKEAWAY_DISPATCHED"'));
  assert.ok(actions.includes('order.status!=="PAID"'));
  const board=fs.readFileSync("app/(employee)/pos/orders/page.tsx","utf8");
  assert.ok(board.includes("Entregado al cliente · cerrar despacho"));

  const sale=fs.readFileSync("src/application/pos/live.ts","utf8");
  assert.ok(sale.includes("POS_LIVE_INVENTORY_SHORTAGE_AUTO_RECORDED"));
  assert.ok(sale.includes("automaticForAllOperators:true"));
  assert.ok(!sale.includes("if(stockShortages.length&&!input.allowStockShortage)"));
  assert.ok(sale.includes("theoreticalQuantity:\"0\""));
  const readiness=fs.readFileSync("src/application/pos/readiness.ts","utf8");
  assert.ok(readiness.includes('warnings.push("Sin conteo inicial:'));
  assert.match(readiness,/warnings\.push\(\s*"Reabastecer:/,
    "El faltante de stock debe ser una advertencia de reabasto, no un bloqueo");
  assert.ok(!readiness.includes('errors.push("Sin saldo inicial:'));
  const split=fs.readFileSync("app/(employee)/pos/orders/[id]/split/actions.ts","utf8");
  assert.ok(!split.includes("allowStockShortage"));
  const checkout=fs.readFileSync("app/(employee)/pos/checkout/payment-form.tsx","utf8");
  assert.ok(!checkout.includes("allowStockShortage"));
  const pos=fs.readFileSync("app/(employee)/pos/pos-client.tsx","utf8");
  assert.ok(pos.includes("Seleccionar mesa en un toque"));
  assert.ok(pos.includes('event.key==="F2"'));
  // Contrast guard: light/dark must keep readable FG and secondary on cards.
  // Ensures theme changes do not leave black text on dark POS surfaces.
  const css=fs.readFileSync("app/globals.css","utf8");
  const epicSection=css.slice(css.indexOf("CAFÉ ÉPICO OPS · VISUAL SYSTEM"));
  const light=epicSection.match(/:root \{([\s\S]*?)\}/)?.[1];
  const dark=epicSection.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)?.[1];
  assert.ok(light&&dark,"Los dos modos deben definir una paleta completa");
  const color=(block,name)=>{
    const found=block.match(new RegExp(name+":(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})(?=[;\\s}])"));
    assert.ok(found,"Falta token "+name);
    const hex=found[1];
    return hex.length===4?"#"+hex.slice(1).split("").map(x=>x+x).join(""):hex;
  };
  const luminance=(hex)=>{
    const parts=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const c=parts.map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  };
  const contrast=(a,b)=>{
    const x=luminance(a),y=luminance(b);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  };
  for(const block of [light,dark]){
    for(const textToken of ["--epic-fg","--epic-secondary"]){
      assert.ok(contrast(color(block,textToken),color(block,"--epic-card"))>=4.5,
        textToken+" no tiene contraste suficiente contra tarjetas");
    }
    assert.ok(contrast(color(block,"--epic-accent-contrast"),color(block,"--epic-accent"))>=4.5,
      "Botones activos sin contraste suficiente");
  }
  assert.match(css,/Fast Lane theme parity/);
  assert.match(css,/main\.pos-shell \.pos-cart :is\(h2,h3,\.pos-total/);
  console.log("OPS Fast Lane: paletas claro/oscuro PASS");
  console.log("OPS fast lane: stock + tiempos + shortcuts PASS");
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
