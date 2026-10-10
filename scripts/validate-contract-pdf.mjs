import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root=process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"epic-maquila-pdf-"));
const requireFromTemp=createRequire(path.join(dir,"runner.cjs"));
try{
  for(const file of ["contract-utils","contract-pdf"]){
    const source=fs.readFileSync(path.join(root,"src/application/roasting",file+".ts"),"utf8");
    const output=ts.transpileModule(source,{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
      esModuleInterop:true,skipLibCheck:true,
    }});
    fs.writeFileSync(path.join(dir,file+".js"),output.outputText);
  }
  const {createContractPdf}=requireFromTemp("./contract-pdf.js");
  const longNotes="Café de especialidad con trazabilidad detallada. ".repeat(35);
  const batches=Array.from({length:4},(_,i)=>({
    id:"test-"+i,batchCode:"MAQUILA-PRUEBA-"+(i+1),
    roastedAt:new Date("2026-10-10T16:10:00.000Z"),
    greenG:"400",roastedG:String(340+i),profile:"Skywalker v1 · Omni",
    firstCrackC:"185.00",dropC:"198.50",durationS:536,dtrPct:"14.200",
    greenDefectSampleG:i===0?"100":null,
    defects:i===0?[
      {type:"Inmaduro",severity:"SECONDARY",count:2,grams:0.40},
      {type:"Negro parcial",severity:"SECONDARY",count:1,grams:0.15},
    ]:[],
    qualityNotes:i===0?longNotes:null,
    sensoryNotes:i===0?"Miel floral, durazno, acidez moderada":null,
  }));
  const fixture={
    client:{
      name:"Productor de café de origen y tostador asociado con una razón social extensa para validar renglones y saltos de página",
      contact:"Departamento de calidad / muestras",email:"control@ejemplo.test",
    },
    lot:{
      coffeeName:"Marsellesa lavado - lote de maquila con nombre técnico largo y trazabilidad de finca",
      origin:"Sierra Mazateca, Oaxaca",process:"Lavado",producer:"Finca de pruebas",
      variety:"Marsellesa",greenReceivedG:"2000",feePerKgGreen:"125",
    },
    batches,deliveries:[{batchId:"test-0",grams:"100"}],
  };
  const pdf=createContractPdf(fixture);
  assert.ok(Buffer.isBuffer(pdf),"PDF generator must return a Buffer");
  assert.ok(pdf.length>3000,"PDF file is unexpectedly short");
  assert.equal(pdf.subarray(0,8).toString("latin1"),"%PDF-1.4");
  const content=pdf.toString("latin1");
  const start=content.lastIndexOf("startxref\\n");
  assert.ok(start>0,"Missing xref pointer");
  const xrefOffset=Number(content.slice(start+10).split(/\\s+/)[0]);
  assert.ok(Number.isSafeInteger(xrefOffset)&&xrefOffset>0);
  assert.equal(content.slice(xrefOffset,xrefOffset+4),"xref");
  const pageCount=Number(content.match(/\\/Count (\\d+)/)?.[1]);
  assert.ok(pageCount>=5,"Expected summary plus four batch pages");
  const poppler=spawnSync("pdftotext",["-","-"],{input:pdf,encoding:"utf8",maxBuffer:3e6});
  if(!poppler.error){
    assert.equal(poppler.status,0,"Poppler cannot parse the generated PDF: "+poppler.stderr);
    assert.match(poppler.stdout,/INFORME TÉCNICO DE MAQUILA/);
    assert.match(poppler.stdout,/MAQUILA-PRUEBA-4/);
    assert.match(poppler.stdout,/DEFECTOS DEL BATCH/);
    assert.match(poppler.stdout,/0[,.]55/);
  } else {
    console.warn("pdftotext unavailable, passed PDF xref/structure smoke checks.");
  }
  console.log("maquila pdf validation: PASS ("+pdf.length+" bytes, "+pageCount+" pages, "+batches.length+" batches)");
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
