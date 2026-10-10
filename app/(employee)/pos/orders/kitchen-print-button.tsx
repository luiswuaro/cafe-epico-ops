"use client";

import Link from "next/link";
import { useState } from "react";
import { KitchenSlip, kitchenCategoryLabel, kitchenRounds, selectedKitchenSlip } from "@/src/application/pos/kitchen-slip";

const TICKET_PRINTER_KEY="cafe-epico-printer-bridge-v1";
const ROUTE_KEY="cafe-epico-kitchen-route-v1";
const KITCHEN_PRINTER_KEY="cafe-epico-kitchen-printer-bridge-v1";
const PAPER_WIDTH=384;
const SIDE_MARGIN=16;
const CONTENT_WIDTH=PAPER_WIDTH-SIDE_MARGIN*2;
const MAX_PRINT_HEIGHT=4900;

type PrinterConfig={url:string;token:string};

function readConfig(key:string):PrinterConfig|null {
  try {
    const json=window.localStorage.getItem(key);
    if(!json)return null;
    const value=JSON.parse(json) as Partial<PrinterConfig>;
    return value.url&&value.token?{url:value.url,token:value.token}:null;
  }catch{return null;}
}

// Dibujar texto en Canvas evita por completo las incompatibilidades de
// páginas de código ESC/POS: á, é, í, ó, ú, ñ, ¿, ¡ y notas de barra.
function wrapByPixels(context:CanvasRenderingContext2D,text:string,maxWidth:number){
  const words=text.trim().replace(/\s+/g," ").split(" ");
  const result:string[]=[];
  let current="";
  for(const word of words){
    const candidate=current?current+" "+word:word;
    if(context.measureText(candidate).width<=maxWidth){
      current=candidate;
      continue;
    }
    if(current){result.push(current);current="";}
    if(context.measureText(word).width<=maxWidth){current=word;continue;}
    let part="";
    for(const char of word){
      const next=part+char;
      if(part&&context.measureText(next).width>maxWidth){
        result.push(part);
        part=char;
      }else part=next;
    }
    current=part;
  }
  if(current)result.push(current);
  return result;
}

function encodeBase64(bytes:Uint8Array) {
  let binary="";
  for(let index=0;index<bytes.length;index+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
  }
  return btoa(binary);
}

async function buildKitchenRaster(slip:KitchenSlip,selection:"latest"|"all",serviceFilter?:"DINE_IN"|"TAKEAWAY"|"BOTH",roundId?:string){
  await document.fonts.ready;
  const selected=roundId
    ?{
      ...selectedKitchenSlip(slip,"all"),
      roundLabel:kitchenRounds(slip.lines).find(round=>round.id===roundId)?.label??"RONDA",
      lines:slip.lines.filter(line=>(line.roundId||"INITIAL")===roundId),
    }
    :selectedKitchenSlip(slip,selection);
  const prepared=serviceFilter
    ?{...selected,lines:selected.lines.filter(line=>
      serviceFilter==="BOTH"
        ?line.serviceMode==="DINE_IN"||line.serviceMode==="TAKEAWAY"
        :line.serviceMode===serviceFilter
    )}
    :selected;
  if(!prepared.lines.length)throw new Error("La comanda no tiene productos para imprimir");

  const canvas=document.createElement("canvas");
  canvas.width=PAPER_WIDTH;
  canvas.height=MAX_PRINT_HEIGHT;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  if(!context)throw new Error("No se pudo generar la comanda gráfica");
  context.fillStyle="#fff";
  context.fillRect(0,0,PAPER_WIDTH,MAX_PRINT_HEIGHT);
  context.fillStyle="#000";
  context.textBaseline="top";

  let y=8;
  const draw=(text:string,font:string,lineHeight:number,align:"left"|"center"="left",indent=0)=>{
    context.font=font;
    context.textAlign=align;
    context.fillStyle="#000";
    const x=align==="center"?PAPER_WIDTH/2:SIDE_MARGIN+indent;
    const maxWidth=align==="center"?CONTENT_WIDTH:CONTENT_WIDTH-indent;
    const rows=wrapByPixels(context,text,maxWidth);
    for(const row of rows){
      if(y+lineHeight+36>MAX_PRINT_HEIGHT)throw new Error("Comanda muy larga; imprime una ronda por separado");
      context.fillText(row,x,y);
      y+=lineHeight;
    }
  };
  const rule=()=>{
    y+=4;
    context.save();
    context.strokeStyle="#000";
    context.lineWidth=2;
    context.setLineDash([5,4]);
    context.beginPath();
    context.moveTo(SIDE_MARGIN,y+1);
    context.lineTo(PAPER_WIDTH-SIDE_MARGIN,y+1);
    context.stroke();
    context.restore();
    y+=10;
  };

  draw("COMANDA DE BARRA","800 21px Arial, Helvetica, sans-serif",26,"center");
  const tableName=/^\d+$/.test(prepared.table.trim())
    ?"MESA "+prepared.table:prepared.table;
  y+=2;
  draw(tableName,"900 38px Arial, Helvetica, sans-serif",44,"center");
  if(prepared.customerName){
    draw("CLIENTE: "+prepared.customerName,
      "800 21px Arial, Helvetica, sans-serif",26,"center");
  }
  const date=new Intl.DateTimeFormat("es-MX",{
    timeZone:"America/Mexico_City",hour:"2-digit",minute:"2-digit",
    hour12:false,
  }).format(new Date());
  draw(prepared.roundLabel+" · "+date,"800 19px Arial, Helvetica, sans-serif",24,"center");
  rule();

  let category="";
  for(const item of prepared.lines){
    const next=kitchenCategoryLabel(item.category);
    if(next!==category){
      category=next;
      if(category!=="")y+=2;
      draw(category,"900 19px Arial, Helvetica, sans-serif",24);
    }
    draw(item.quantity+"× "+item.name,"900 25px Arial, Helvetica, sans-serif",29);
    // El destino de cada bebida siempre va explícito, incluso en una
    // comanda mixta con productos iguales y distintas modalidades.
    const destination=item.serviceMode==="TAKEAWAY"?"PARA LLEVAR"
      :item.serviceMode==="DINE_IN"?"AQUÍ":"SERVICIO SIN DEFINIR";
    draw(destination,"900 19px Arial, Helvetica, sans-serif",23,"left",12);
    if(item.note)
      draw("NOTA: "+item.note,"900 20px Arial, Helvetica, sans-serif",24,"left",12);
    y+=4;
  }

  if(prepared.orderNote){
    rule();
    draw("NOTA MESA: "+prepared.orderNote,
      "900 20px Arial, Helvetica, sans-serif",24);
  }
  rule();
  // Referencia corta para distinguir reimpresiones sin gastar una línea
  // completa de papel con el UUID/folio del ticket.
  const suffix=slip.folio.slice(-6);
  draw("Ref. "+suffix,"700 16px Arial, Helvetica, sans-serif",20,"center");
  y+=26; // Zona de seguridad para evitar que el último texto quede en el corte.
  if(y>MAX_PRINT_HEIGHT)throw new Error("Comanda muy larga");
  const height=Math.ceil(y);
  const pixels=context.getImageData(0,0,PAPER_WIDTH,height).data;
  const bytesPerRow=PAPER_WIDTH/8;
  const packed=new Uint8Array(bytesPerRow*height);
  for(let row=0;row<height;row++){
    for(let col=0;col<PAPER_WIDTH;col++){
      const offset=(row*PAPER_WIDTH+col)*4;
      const luminance=0.2126*pixels[offset]+0.7152*pixels[offset+1]+0.0722*pixels[offset+2];
      if(luminance<190)packed[row*bytesPerRow+Math.floor(col/8)]|=0x80>>(col%8);
    }
  }
  return {dataBase64:encodeBase64(packed),width:PAPER_WIDTH,height,align:"center" as const};
}

export async function printKitchenSlip(
  slip:KitchenSlip,
  selection:"latest"|"all"="latest",
  serviceFilter?:"DINE_IN"|"TAKEAWAY"|"BOTH",
  roundId?:string,
):Promise<string>{
  const separate=window.localStorage.getItem(ROUTE_KEY)==="separate";
  const config=readConfig(separate?KITCHEN_PRINTER_KEY:TICKET_PRINTER_KEY);
  if(!config)throw new Error(separate
    ?"Configura la impresora de barra en POS > Impresora."
    :"Configura la impresora de tickets en POS > Impresora.");
  if(!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/.test(config.url)){
    throw new Error("El puente debe usar localhost. Revisa configuración.");
  }
  // Evitar tiras de símbolos cuando un firmware térmico deja de interpretar
  // una imagen raster grande. Las versiones anteriores del puente mandaban
  // todo el bitmap en un único comando GS v 0.
  const statusResponse=await fetch(config.url.replace(/\/$/,"")+"/status",{
    headers:{"X-Cafe-Epico-Token":config.token},
    cache:"no-store",
  });
  if(!statusResponse.ok)throw new Error("No se pudo verificar el puente ESC/POS.");
  const bridge=await statusResponse.json() as {
    ok?:boolean;version?:string;rasterBands?:boolean;
  };
  if(!bridge.ok||bridge.rasterBands!==true){
    throw new Error("Actualiza el puente de impresión a la versión 1.3.0 antes de imprimir comandas. Evitamos enviar bytes gráficos que la impresora podría imprimir como símbolos.");
  }
  const raster=await buildKitchenRaster(slip,selection,serviceFilter,roundId);
  const response=await fetch(config.url.replace(/\/$/,"")+"/print",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Cafe-Epico-Token":config.token},
    body:JSON.stringify({raster,feed:2,cut:false}),
  });
  const result=await response.json() as {ok?:boolean;error?:string;printer?:string};
  if(!response.ok||!result.ok)throw new Error(result.error||"La impresora no respondió");
  return result.printer||"impresora";
}

export function KitchenPrintButton({
  slip,viewUrl,compact=false,
}:{
  slip:KitchenSlip;viewUrl:string;compact?:boolean;
}){
  const [selection,setSelection]=useState<"latest"|"all">("latest");
  const [status,setStatus]=useState<"idle"|"printing"|"ok"|"error">("idle");
  const [message,setMessage]=useState("");
  const rounds=selectedKitchenSlip(slip,"all").roundsCount;

  async function print(){
    if(status==="printing")return;
    setStatus("printing");setMessage("");
    try{
      const printer=await printKitchenSlip(slip,selection);
      setStatus("ok");setMessage("Enviada a "+printer);
    }catch(e){
      setStatus("error");
      setMessage(e instanceof Error?e.message:"No se pudo imprimir");
    }
  }

  return <div className={"kitchen-print-actions"+(compact?" kitchen-print-compact":"")}>
    <div className="kitchen-print-controls">
      <button type="button" onClick={print} disabled={status==="printing"}>
        {status==="printing"?"Enviando…":status==="ok"?"Comanda enviada ✓":"Imprimir comanda"}
      </button>
      {rounds>1&&<select aria-label="Qué ronda imprimir" value={selection}
        onChange={event=>{setSelection(event.target.value as "latest"|"all");setStatus("idle");}}>
        <option value="latest">Última ronda</option>
        <option value="all">Toda la comanda</option>
      </select>}
      <Link className="button" href={viewUrl}>Vista / navegador</Link>
    </div>
    {message&&<small className={status==="error"?"status-bad":"status-ok"} role="status">{message}</small>}
  </div>;
}
