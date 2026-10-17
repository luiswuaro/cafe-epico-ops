import assert from "node:assert/strict";
import {test} from "node:test";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const renderer=resolve(fileURLToPath(new URL("./Render-PrintTicketRaster.ps1",import.meta.url)));

function render(payload){
 const child=spawnSync("powershell.exe",[
   "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
   "-File",renderer,
 ],{input:JSON.stringify(payload),encoding:"utf8",
   timeout:45000,maxBuffer:2_500_000,windowsHide:true});
 assert.equal(child.error,undefined,"No se pudo ejecutar powershell.exe");
 assert.equal(child.status,0,child.stderr?.slice(0,1200));
 const result=JSON.parse(child.stdout);
 assert.equal(result.raster.width,384);
 assert.equal(result.raster.align,"center");
 assert.ok(result.raster.height>60&&result.raster.height<5000);
 const pixels=Buffer.from(result.raster.dataBase64,"base64");
 assert.equal(pixels.length,48*result.raster.height);
 assert.ok(pixels.some(value=>value!==0),"El ticket tiene que contener tinta");
 return {result,pixels};
}
test("GDI Windows pinta acentos, ñ, logo, notas y puntos en un único raster ESC/POS",()=>{
 assert.equal(process.platform,"win32","Prueba exclusiva de runner Windows");
 const logo=Buffer.from([0xff,0x81,0x81,0xff]).toString("base64");
 const payload={
   logo:{dataBase64:logo,width:8,height:4,align:"center"},
   lines:[
     {text:"Café Épico",bold:true,align:"center",size:"double"},
     {text:"COMANDA DE BARRA",bold:true,align:"center",size:"normal"},
     {text:"Latte español con piña y limón",bold:true,align:"left",size:"normal"},
     {text:"NOTA: sin azúcar, año 2026",bold:false,align:"left",size:"normal"},
     {text:"Total $70.00",bold:true,align:"right",size:"normal"},
     {text:"Puntos ganados +3.50",bold:false,align:"left",size:"normal"},
   ],feed:2,cut:false,
 };
 const rendered=render(payload);
 assert.equal(rendered.result.feed,2);
 assert.equal(rendered.result.cut,false);
 const variant=render({...payload,lines:payload.lines.map(line=>({
   ...line,text:line.text.replaceAll("é","e").replaceAll("ñ","n") 
     .replaceAll("í","i").replaceAll("ú","u") 
 }))});
 assert.notDeepEqual(rendered.pixels,variant.pixels,
   "El texto Unicode debe producir píxeles distintos");
});
test("GDI Windows rechaza render excesivo sin producir papel ni JSON válido",()=>{
 const child=spawnSync("powershell.exe",[
   "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
   "-File",renderer,
 ],{input:JSON.stringify({lines:Array.from({length:241},
   ()=>({text:"L",align:"left"})),feed:1,cut:false}),
   encoding:"utf8",timeout:20000,maxBuffer:2_500_000,windowsHide:true});
 assert.notEqual(child.status,0);
});

test("GDI persistente procesa dos tickets en un mismo proceso Windows",()=>{
 const ticket={lines:[
   {text:"Café Épico",align:"center",bold:true,size:"double"},
   {text:"Latte español",align:"left",bold:false,size:"normal"},
   {text:"Puntos 2.50",align:"right",bold:true,size:"normal"},
 ],feed:2,cut:false};
 const input=JSON.stringify(ticket)+"\n"+JSON.stringify(ticket)+"\n";
 const started=performance.now();
 const child=spawnSync("powershell.exe",[
   "-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass",
   "-File",renderer,"-Stream",
 ],{input,encoding:"utf8",timeout:45000,
   maxBuffer:2_500_000,windowsHide:true});
 assert.equal(child.status,0,child.stderr?.slice(0,1000));
 const lines=child.stdout.trim().split(/\r?\n/);
 assert.equal(lines.length,2,"Un JSON de salida por cada ticket");
 for(const json of lines){
   const response=JSON.parse(json);
   assert.equal(response.raster.width,384);
   assert.equal(Buffer.from(response.raster.dataBase64,"base64").length,
     48*response.raster.height);
 }
 console.log("GDI stream 2 tickets ms:",Math.round(performance.now()-started));
});
