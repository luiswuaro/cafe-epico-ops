import type { getContractReportData } from "./contracts";
import { inspectDefects,mass,round2 } from "./contracts";

type Report=NonNullable<Awaited<ReturnType<typeof getContractReportData>>>;
type PDFPage={content:string[];y:number;number:number};

const paper={width:595,height:842,left:42,right:553};
function fmt(n:number,d=2){
  return new Intl.NumberFormat("es-MX",{minimumFractionDigits:0,maximumFractionDigits:d}).format(n);
}
const total=(v:number[])=>round2(v.reduce((x,y)=>x+y,0));

/**
 * Lightweight server-only branded PDF (PDF 1.4, Helvetica WinAnsi).
 * No remote assets, no page-injection from customer-supplied fields.
 */
export function createContractPdf(report:Report) {
  const all=report.batches;
  const green=total(all.map(b=>mass(b.greenG)));
  const roasted=total(all.map(b=>mass(b.roastedG)));
  const delivered=total(all.map(b=>total(report.deliveries.filter(d=>d.batchId===b.id).map(d=>mass(d.grams)))));
  const sampleG=total(all.map(b=>mass(b.greenDefectSampleG)));
  const defectG=total(all.map(b=>inspectDefects(mass(b.greenDefectSampleG)||null,b.defects).totalG));
  const qualityBatches=all.filter(b=>mass(b.greenDefectSampleG)>0).length;
  const fee=round2(green/1000*mass(report.lot.feePerKgGreen));
  const now=new Intl.DateTimeFormat("es-MX",{dateStyle:"long",timeZone:"America/Mexico_City"}).format(new Date());
  const date=(d:Date)=>new Intl.DateTimeFormat("es-MX",{
    dateStyle:"short",timeStyle:"short",timeZone:"America/Mexico_City",
  }).format(d);
  const pages:PDFPage[]=[];
  let current:PDFPage={content:[],y:paper.height-45,number:1};
  pages.push(current);
  const safe=(s:unknown)=>String(s??"").normalize("NFC")
    .replace(/[\r\n\t]+/g," ").replace(/[^\x20-\xFF]/g,"?").trim();
  const escape=(s:unknown)=>safe(s).replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)");
  function fill(rgb:[number,number,number]){
    return rgb.map(x=>(x/255).toFixed(3)).join(" ")+" rg";
  }
  const ink:[number,number,number]=[31,42,36];
  const muted:[number,number,number]=[102,112,106];
  const greenColor:[number,number,number]=[45,89,64];
  function rect(x:number,y:number,w:number,h:number,color:[number,number,number]) {
    current.content.push(fill(color)+` ${x} ${y} ${w} ${h} re f`);
  }
  function line(x1:number,y1:number,x2:number,y2:number){
    current.content.push(`0.82 0.85 0.82 RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  function label(x:number,y:number,value:unknown,size=10,bold=false,color=ink){
    current.content.push(fill(color)+` BT /${bold?"FB":"FR"} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escape(value)}) Tj ET`);
  }
  function wrap(value:unknown,max=94){
    const words=safe(value).split(/\s+/).filter(Boolean),lines:string[]=[];
    let buffer="";
    for(const word of words) {
      if(buffer&&buffer.length+1+word.length>max){
        lines.push(buffer);buffer=word;
      } else buffer=buffer?buffer+" "+word:word;
      if(buffer.length>max){
        lines.push(buffer.slice(0,max));buffer=buffer.slice(max);
      }
    }
    if(buffer)lines.push(buffer);
    return lines.length?lines:["-"];
  }
  function footer(){
    line(paper.left,45,paper.right,45);
    label(paper.left,30,"CAFÉ ÉPICO · INGENIERÍA DEL CAFÉ · TEPEXI DE RODRÍGUEZ, PUE.",7,false,muted);
    label(492,30,`PÁG. ${current.number}`,8,true,muted);
  }
  function nextPage(title:string){
    footer();
    current={content:[],y:paper.height-46,number:pages.length+1};
    pages.push(current);
    rect(0,paper.height-86,paper.width,86,ink);
    label(paper.left,paper.height-48,"CAFÉ ÉPICO / REPORTE DE MAQUILA",11,true,[242,240,232]);
    label(paper.left,paper.height-69,title,10,false,[188,213,198]);
    current.y=paper.height-112;
  }
  function need(height:number){
    if(current.y-height<66)nextPage("Continuación · control de calidad");
  }
  function heading(value:string){
    need(42);label(paper.left,current.y,value,14,true,ink);current.y-=15;
    line(paper.left,current.y,paper.right,current.y);current.y-=20;
  }
  function row(left:unknown,right:unknown){
    need(24);label(paper.left,current.y,left,9,false,muted);
    label(349,current.y,right,10,true,ink);
    current.y-=22;
  }
  function paragraph(title:string,value:unknown){
    const ls=wrap(value,101);need(36+ls.length*13);
    label(paper.left,current.y,title,10,true,greenColor);current.y-=19;
    for(const s of ls){label(paper.left,current.y,s,9,false,ink);current.y-=14;}
    current.y-=10;
  }

  rect(0,720,paper.width,122,ink);
  rect(paper.left,754,54,4,[169,211,183]);
  label(paper.left,808,"CAFÉ ÉPICO / INGENIERÍA DEL CAFÉ",13,true,[248,247,239]);
  label(paper.left,775,"INFORME TÉCNICO DE MAQUILA",21,true,[248,247,239]);
  label(paper.left,741,"CONTROL DE TUESTE · TRAZABILIDAD · DEFECTOS",10,false,[194,221,205]);
  current.y=699;
  label(paper.left,current.y,"CLIENTE / PROPIETARIO DEL CAFÉ",9,true,greenColor);current.y-=21;
  label(paper.left,current.y,report.client.name,18,true,ink);current.y-=23;
  if(report.client.contact) {label(paper.left,current.y,"Contacto: "+report.client.contact,10);current.y-=18;}
  if(report.client.email) {label(paper.left,current.y,"Correo: "+report.client.email,9,false,muted);current.y-=18;}
  current.y-=10;
  heading("1. IDENTIFICACIÓN DEL LOTE");
  row("Café recibido",report.lot.coffeeName);
  row("Origen / proceso",(report.lot.origin??"No indicado")+" / "+(report.lot.process??"No indicado"));
  row("Productor / variedad",(report.lot.producer??"No indicado")+" / "+(report.lot.variety??"No indicado"));
  row("Verde total recibido en custodia",fmt(mass(report.lot.greenReceivedG))+" g");
  row("Batches seleccionados para el informe",String(all.length));
  row("Fecha de emisión",now);
  heading("2. BALANCE DE BATCHES SELECCIONADOS");
  row("Café verde procesado",fmt(green)+" g");
  row("Café tostado obtenido",fmt(roasted)+" g");
  row("Merma de tueste",fmt(green-roasted)+" g ("+fmt(green?(green-roasted)/green*100:0)+"%)");
  row("Tostado entregado de estos batches",fmt(delivered)+" g");
  row("Tostado pendiente de entrega",fmt(roasted-delivered)+" g");
  row("Servicio estimado por kg verde",fmt(mass(report.lot.feePerKgGreen))+" MXN/kg");
  row("Subtotal de servicio para selección",fmt(fee)+" MXN (sin IVA calculado)");
  heading("3. INSPECCIÓN DE DEFECTOS");
  row("Batches con muestra inspeccionada",qualityBatches+" / "+all.length);
  row("Muestra inspeccionada total",sampleG>0?fmt(sampleG)+" g":"No evaluado");
  row("Masa de defectos identificados",sampleG>0?fmt(defectG)+" g":"No evaluado");
  row("Defectos por peso de muestra",sampleG>0?fmt(defectG/sampleG*100)+"%":"No evaluado");
  paragraph("METODOLOGÍA Y ALCANCE",
    "Porcentaje de defectos = masa de defectos observada (g) / peso de muestra verde inspeccionada (g) x 100. No corresponde automáticamente a clasificación SCA ni determina puntuación de taza. Batches sin muestra quedan fuera del porcentaje conjunto. Las notas sensoriales sólo se informan cuando fueron registradas.");
  footer();

  for(const [index,b] of all.entries()){
    nextPage(`BATCH ${index+1} DE ${all.length} · ${b.batchCode}`);
    heading(`BATCH ${b.batchCode}`);
    row("Fecha de tostado",date(b.roastedAt));
    row("Perfil / equipo",b.profile??"No documentado");
    row("Peso verde inicial",fmt(mass(b.greenG))+" g");
    row("Peso tostado final",fmt(mass(b.roastedG))+" g");
    row("Merma real",fmt((mass(b.greenG)-mass(b.roastedG))/mass(b.greenG)*100)+"%");
    row("Salida vs carga",fmt(mass(b.roastedG)/mass(b.greenG)*100)+"%");
    row("Primera crack (°C)",b.firstCrackC==null?"No medido":fmt(mass(b.firstCrackC))+" °C");
    row("Temperatura de drop",b.dropC==null?"No medido":fmt(mass(b.dropC))+" °C");
    row("Tiempo total",b.durationS==null?"No medido":Math.floor(b.durationS/60)+":"+String(b.durationS%60).padStart(2,"0"));
    row("DTR",b.dtrPct==null?"No medido":fmt(mass(b.dtrPct))+"%");
    const oneDelivered=total(report.deliveries.filter(d=>d.batchId===b.id).map(d=>mass(d.grams)));
    row("Tostado entregado",fmt(oneDelivered)+" g");
    row("Pendiente de entrega",fmt(mass(b.roastedG)-oneDelivered)+" g");

    heading("DEFECTOS DEL BATCH / MUESTRA VERDE");
    const assessed=inspectDefects(mass(b.greenDefectSampleG)||null,b.defects);
    row("Peso de muestra",assessed.measured?fmt(mass(b.greenDefectSampleG))+" g":"No evaluado");
    row("Defectos por masa",assessed.percentage==null?"No evaluado":
      fmt(assessed.totalG)+" g / "+fmt(assessed.percentage)+"%");
    row("Defectos contados",assessed.measured?String(assessed.counts)+" piezas":"No evaluado");
    if(b.defects.length){
      need(20);label(paper.left,current.y,"TIPO",9,true,greenColor);
      label(365,current.y,"CATEGORÍA / PZ",9,true,greenColor);
      label(494,current.y,"GRAMOS",9,true,greenColor);current.y-=15;
      for(const defect of b.defects){
        need(22);line(paper.left,current.y+7,paper.right,current.y+7);
        label(paper.left,current.y,defect.type,9,false,ink);
        label(365,current.y,(defect.severity==="PRIMARY"?"Prim.":defect.severity==="SECONDARY"?"Sec.":"Otro")+
          " / "+defect.count,9,false,muted);
        label(501,current.y,fmt(defect.grams),9,true,ink);
        current.y-=19;
      }
    } else paragraph("REGISTRO DE DEFECTOS",assessed.measured?
      "Se inspeccionó la muestra; no se documentaron defectos en esta evaluación.":
      "No se realizó o no se documentó una inspección de muestra.");

    paragraph("OBSERVACIONES DE PROCESO / CALIDAD",b.qualityNotes??"No documentado.");
    paragraph("EVALUACIÓN SENSORIAL",b.sensoryNotes??"No evaluado.");
    // footer done on new page or at end.
  }
  footer();

  // Basic PDF objects, lengths and xref refer to bytes (WinAnsi Latin-1), not UTF-16.
  const objects:string[]=[""];
  const add=(source:string)=>{objects.push(source);return objects.length-1;};
  const regular=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesId=add("");
  const kids:number[]=[];
  for(const page of pages){
    const bytes=Buffer.from(page.content.join("\n")+"\n","latin1");
    const contentId=add(`<< /Length ${bytes.length} >>\nstream\n${bytes.toString("latin1")}endstream`);
    const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${paper.width} ${paper.height}] /Resources << /Font << /FR ${regular} 0 R /FB ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(pageId);
  }
  objects[pagesId]=`<< /Type /Pages /Kids [${kids.map(k=>k+" 0 R").join(" ")}] /Count ${kids.length} >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf="%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets=[0];
  for(let i=1;i<objects.length;i++){
    offsets[i]=Buffer.byteLength(pdf,"latin1");
    pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref=Buffer.byteLength(pdf,"latin1");
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)
    pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";
  pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf,"latin1");
}
