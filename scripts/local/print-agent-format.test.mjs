import assert from "node:assert/strict";
import {test} from "node:test";
import {wrapped,sanitized,printAgentPayload} from "./print-agent-format.mjs";

test("comanda conserva productos, notas, destino y folio",()=>{
 const out=printAgentPayload({
   kind:"KITCHEN",slip:{folio:"OPS-123456",table:"Mesa balcón 1",customerName:"Ana",
     lines:[{quantity:2,name:"Latte español",serviceMode:"TAKEAWAY",
       note:"Sin hielo, extra leche"}],orderNote:"Se entrega junto"}
 },{},new Date("2026-10-17T13:00:00Z"));
 const text=out.lines.map(x=>x.text).join(" ");
 for(const term of ["COMANDA","Mesa balcón","Latte español","PARA LLEVAR",
   "Sin hielo","Se entrega junto","123456"])assert.ok(text.includes(term),term);
 assert.equal(out.feed,2);
});
test("ticket conserva puntos, métodos de pago, cliente y descuentos",()=>{
 const out=printAgentPayload({
   kind:"RECEIPT",ticket:{
     folio:"OPS-1001",status:"PAID",date:"16/10/2026",employee:"Azucena",
     service:"Para llevar",items:[{quantity:1,name:"Moka frío",
       extra:"Leche de almendra",note:"Sin crema",total:"$70.00"}],
     total:"$70.00",payment:"Transferencia $50 + Puntos $20",
     pointsRedeemed:"20",monetaryPaid:"$50",
     pointsEarned:"2.50",pointsBalance:"22.50",customer:"Cliente QA",
   }
 },{businessName:"Café Épico",feedLines:3,showNoCfdi:true});
 const all=out.lines.map(x=>x.text).join(" ");
 for(const token of ["Café Épico","Moka frío","almendra","Sin crema",
   "Transferencia","Puntos usados: 20","Saldo puntos: 22.50",
   "Cliente QA","Este ticket no es CFDI"])
   assert.ok(all.includes(token),token);
 assert.equal(out.cut,false);
});
test("rango de textos y configuración de corte",()=>{
 assert.equal(sanitized("abc\n\t\x00de"),"abc de");
 assert.ok(wrapped("abcdefghij".repeat(7),32).every(line=>line.length<=32));
 const result=printAgentPayload({kind:"PREBILL",ticket:{
   folio:"A",date:"hoy",employee:"QA",service:"Mesa",items:[],total:"$60",
   paidAmount:"$20",outstanding:"$40",status:"SENT",
 }},{feedLines:100,lineWidthChars:2,autoCut:true});
 assert.equal(result.feed,8);
 assert.ok(result.lines.some(row=>row.text.includes("Por pagar")));
});
test("rechaza comanda vacía y tipo inesperado",()=>{
 assert.throws(()=>printAgentPayload({kind:"KITCHEN",slip:{lines:[]}}));
 assert.throws(()=>printAgentPayload({kind:"UNKNOWN"}));
});

test("logo existente de OPS viaja como raster antes del ticket en el mismo trabajo",()=>{
 const logo=Buffer.from([0x80,0x40]).toString("base64");
 const job={kind:"RECEIPT",ticket:{folio:"QA-LOGO",date:"hoy",
   employee:"QA",service:"Aquí",items:[],total:"$0",payment:"Prueba",
   status:"PAID"}};
 const out=printAgentPayload(job,{showLogo:true,logoRasterBase64:logo,
   logoWidthPx:8,logoHeightPx:2,logoAlign:"center"});
 assert.deepEqual(out.logo,{dataBase64:logo,width:8,height:2,align:"center"});
 const corrupted=printAgentPayload(job,{showLogo:true,logoRasterBase64:"AAAAAA",
   logoWidthPx:8,logoHeightPx:2});
 assert.equal(corrupted.logo,null);
 const hidden=printAgentPayload(job,{showLogo:false,logoRasterBase64:logo,
   logoWidthPx:8,logoHeightPx:2});
 assert.equal(hidden.logo,null);
});
