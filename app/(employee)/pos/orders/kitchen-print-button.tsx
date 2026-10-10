"use client";

import Link from "next/link";
import { useState } from "react";
import { KitchenSlip, kitchenCategoryLabel, selectedKitchenSlip } from "@/src/application/pos/kitchen-slip";

const TICKET_PRINTER_KEY="cafe-epico-printer-bridge-v1";
const ROUTE_KEY="cafe-epico-kitchen-route-v1";
const KITCHEN_PRINTER_KEY="cafe-epico-kitchen-printer-bridge-v1";

type PrinterConfig={url:string;token:string};
type PrintLine={text:string;bold?:boolean;align?:"left"|"center"|"right";size?:"normal"|"double"};

function readConfig(key:string):PrinterConfig|null {
  try {
    const json=window.localStorage.getItem(key);
    if(!json)return null;
    const value=JSON.parse(json) as Partial<PrinterConfig>;
    return value.url&&value.token?{url:value.url,token:value.token}:null;
  }catch{return null;}
}

function wrap(text:string,width=30){
  const words=text.trim().replace(/\s+/g," ").split(" ");
  const rows:string[]=[];let current="";
  for(const word of words){
    if(word.length>width){
      if(current)rows.push(current);
      for(let i=0;i<word.length;i+=width)rows.push(word.slice(i,i+width));
      current="";continue;
    }
    const candidate=current?current+" "+word:word;
    if(candidate.length>width){if(current)rows.push(current);current=word;}
    else current=candidate;
  }
  if(current)rows.push(current);
  return rows;
}

function buildLines(slip:KitchenSlip,selection:"latest"|"all"):PrintLine[]{
  const prepared=selectedKitchenSlip(slip,selection);
  const date=new Intl.DateTimeFormat("es-MX",{
    timeZone:"America/Mexico_City",hour:"2-digit",minute:"2-digit",
  }).format(new Date());
  const lines:PrintLine[]=[
    {text:"COMANDA DE BARRA",bold:true,align:"center"},
    ...wrap(prepared.table,16).map((text):PrintLine=>({text,bold:true,size:"double",align:"center"})),
    {text:prepared.roundLabel+" · "+date,bold:true,align:"center"},
    {text:"------------------------------"},
  ];
  let category="";
  for(const item of prepared.lines){
    const next=kitchenCategoryLabel(item.category);
    if(next!==category){
      category=next;
      lines.push({text:category,bold:true});
    }
    for(const text of wrap(item.quantity+"x "+item.name,30))
      lines.push({text,bold:true});
    if(item.serviceMode==="TAKEAWAY")lines.push({text:"  PARA LLEVAR"});
    if(item.note)for(const text of wrap("NOTA: "+item.note,30))
      lines.push({text,bold:true});
  }
  if(prepared.orderNote){
    lines.push({text:"------------------------------"});
    for(const text of wrap("MESA: "+prepared.orderNote,30))
      lines.push({text,bold:true});
  }
  lines.push({text:slip.folio,align:"center"});
  return lines;
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
    const separate=window.localStorage.getItem(ROUTE_KEY)==="separate";
    const config=readConfig(separate?KITCHEN_PRINTER_KEY:TICKET_PRINTER_KEY);
    if(!config){
      setStatus("error");
      setMessage(separate
        ?"Configura y prueba la impresora de barra en POS > Impresora."
        :"Configura la impresora de tickets en POS > Impresora.");
      return;
    }
    if(!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/.test(config.url)){
      setStatus("error");setMessage("El puente debe usar localhost. Revisa configuración.");return;
    }
    setStatus("printing");setMessage("");
    try{
      const response=await fetch(config.url.replace(/\/$/,"")+"/print",{
        method:"POST",
        headers:{"Content-Type":"application/json","X-Cafe-Epico-Token":config.token},
        body:JSON.stringify({lines:buildLines(slip,selection),feed:1,cut:false}),
      });
      const result=await response.json() as {ok?:boolean;error?:string;printer?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||"La impresora no respondió");
      setStatus("ok");setMessage("Enviada a "+(result.printer||"impresora"));
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
